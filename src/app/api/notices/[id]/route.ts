import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../utils/db";
import { verifyJwt } from "../../utils/jwt";

// 인증 헤더 상수
const AUTH_HEADER = "authorization";

/**
 * 공지사항 상세 조회 API
 * GET /api/notices/[id]
 * @param request - NextRequest 객체
 * @returns 공지사항 상세 정보
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    if (!id || isNaN(parseInt(id))) {
      return NextResponse.json(
        { error: "유효하지 않은 ID입니다." },
        { status: 400 }
      );
    }

    // 인증 확인 (선택적)
    const authHeader = request.headers.get(AUTH_HEADER);
    const token = authHeader?.split(" ")[1];
    const userId = token ? verifyJwt(token)?.id : null;

    const connection = await pool.getConnection();

    // 조회수 증가
    await connection.query(
      "UPDATE notices SET view_count = view_count + 1 WHERE id = ?",
      [id]
    );

    // 공지사항 상세 조회
    const [noticeRows] = await connection.query(
      `SELECT 
        n.id, n.title, n.content, 
        n.created_at, n.updated_at, 
        n.view_count, n.like_count, 
        (SELECT COUNT(*) FROM notice_comments WHERE notice_id = n.id) AS comment_count,
        u.id AS author_id, u.name AS author_name,
        n.is_pinned,
        JSON_ARRAYAGG(DISTINCT ni.image_url) AS image_urls,
        EXISTS(SELECT 1 FROM notice_likes WHERE notice_id = n.id AND user_id = ?) AS is_liked
      FROM notices n
      JOIN users u ON n.author_id = u.id
      LEFT JOIN notice_images ni ON n.id = ni.notice_id
      WHERE n.id = ?
      GROUP BY n.id`,
      [userId || 0, id]
    );

    if ((noticeRows as any[]).length === 0) {
      connection.release();
      return NextResponse.json(
        { error: "존재하지 않는 공지사항입니다." },
        { status: 404 }
      );
    }

    // 이미지 URLs 처리 (NULL 값 제거)
    const notice = {
      ...(noticeRows as any[])[0],
      image_urls:
        (noticeRows as any[])[0].image_urls &&
        (noticeRows as any[])[0].image_urls[0] !== null
          ? (noticeRows as any[])[0].image_urls
          : [],
      is_liked: !!(noticeRows as any[])[0].is_liked,
    };

    connection.release();

    return NextResponse.json({
      success: true,
      notice,
    });
  } catch (error) {
    console.error("공지사항 상세 조회 오류:", error);
    return NextResponse.json(
      { error: "공지사항 상세 조회에 실패했습니다." },
      { status: 500 }
    );
  }
}

/**
 * 공지사항 수정 API
 * PUT /api/notices/[id]
 * @param request - 요청 객체 (제목, 내용, 이미지 포함)
 * @param params - URL 파라미터 (id)
 * @returns 수정된 공지사항 정보
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // 인증 확인
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = authHeader?.split(" ")[1];
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const payload = verifyJwt(token);
  const userId = payload?.id;
  const { id } = params;

  if (!id || isNaN(parseInt(id))) {
    return NextResponse.json(
      { error: "유효하지 않은 ID입니다." },
      { status: 400 }
    );
  }

  // FormData 파싱
  const formData = await request.formData();
  const title = formData.get("title") as string;
  const content = formData.get("content") as string;
  const isPinned = formData.get("is_pinned") === "true";
  const existingImagesJson = formData.get("existing_images") as string;
  let existingImages: string[] = [];

  try {
    existingImages = existingImagesJson ? JSON.parse(existingImagesJson) : [];
  } catch (e) {
    return NextResponse.json(
      { error: "기존 이미지 목록 형식이 잘못되었습니다." },
      { status: 400 }
    );
  }

  // 새 이미지 파일들
  const newImages = formData.getAll("new_images") as File[];

  // 제목 및 내용 유효성 검증
  if (!title || !content) {
    return NextResponse.json(
      { error: "제목과 내용은 필수 항목입니다." },
      { status: 400 }
    );
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 공지사항 작성자 확인
    const [authorRows] = await connection.query(
      "SELECT author_id FROM notices WHERE id = ?",
      [id]
    );

    if ((authorRows as any[]).length === 0) {
      await connection.rollback();
      connection.release();
      return NextResponse.json(
        { error: "존재하지 않는 공지사항입니다." },
        { status: 404 }
      );
    }

    const authorId = (authorRows as any[])[0].author_id;
    // 작성자만 수정 가능 (관리자 권한 확인 로직 추가 가능)
    if (authorId !== userId) {
      await connection.rollback();
      connection.release();
      return NextResponse.json(
        { error: "수정 권한이 없습니다." },
        { status: 403 }
      );
    }

    // 공지사항 수정
    await connection.query(
      "UPDATE notices SET title = ?, content = ?, is_pinned = ?, updated_at = NOW() WHERE id = ?",
      [title, content, isPinned ? 1 : 0, id]
    );

    // 기존 이미지 처리 (삭제된 이미지 제거)
    const [currentImagesRows] = await connection.query(
      "SELECT image_url FROM notice_images WHERE notice_id = ?",
      [id]
    );

    const currentImages = (currentImagesRows as any[]).map(
      (img) => img.image_url
    );

    // 삭제할 이미지 찾기
    const imagesToDelete = currentImages.filter(
      (imgUrl) => !existingImages.includes(imgUrl)
    );

    // 이미지 삭제
    if (imagesToDelete.length > 0) {
      for (const imageUrl of imagesToDelete) {
        await connection.query(
          "DELETE FROM notice_images WHERE notice_id = ? AND image_url = ?",
          [id, imageUrl]
        );

        // 실제 파일 시스템에서 이미지 삭제 로직 (필요 시)
        // await deleteImageFromStorage(imageUrl);
      }
    }

    // 새 이미지 처리
    if (newImages.length > 0) {
      for (const image of newImages) {
        const buffer = Buffer.from(await image.arrayBuffer());
        // 이미지 저장 로직 (예시)
        // const imageUrl = await uploadImageToStorage(buffer, image.name);

        // 임시로 이미지 URL 생성
        const imageUrl = `/uploads/notices/${id}/${image.name}`;

        // 이미지 정보 DB 저장
        await connection.query(
          "INSERT INTO notice_images (notice_id, image_url) VALUES (?, ?)",
          [id, imageUrl]
        );
      }
    }

    // 수정된 공지사항 조회
    const [noticeRows] = await connection.query(
      `SELECT 
        n.id, n.title, n.content, 
        n.created_at, n.updated_at, 
        n.view_count, n.like_count, 
        (SELECT COUNT(*) FROM notice_comments WHERE notice_id = n.id) AS comment_count,
        u.id AS author_id, u.name AS author_name,
        n.is_pinned,
        JSON_ARRAYAGG(DISTINCT ni.image_url) AS image_urls,
        EXISTS(SELECT 1 FROM notice_likes WHERE notice_id = n.id AND user_id = ?) AS is_liked
      FROM notices n
      JOIN users u ON n.author_id = u.id
      LEFT JOIN notice_images ni ON n.id = ni.notice_id
      WHERE n.id = ?
      GROUP BY n.id`,
      [userId, id]
    );

    await connection.commit();
    connection.release();

    // 이미지 URLs 처리 (NULL 값 제거)
    const notice = {
      ...(noticeRows as any[])[0],
      image_urls:
        (noticeRows as any[])[0].image_urls &&
        (noticeRows as any[])[0].image_urls[0] !== null
          ? (noticeRows as any[])[0].image_urls
          : [],
      is_liked: !!(noticeRows as any[])[0].is_liked,
    };

    return NextResponse.json({
      success: true,
      notice,
    });
  } catch (error) {
    console.error("공지사항 수정 오류:", error);
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    return NextResponse.json(
      { error: "공지사항 수정에 실패했습니다." },
      { status: 500 }
    );
  }
}

/**
 * 공지사항 삭제 API
 * DELETE /api/notices/[id]
 * @param request - NextRequest 객체
 * @param params - URL 파라미터 (id)
 * @returns 성공 여부
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // 인증 확인
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = authHeader?.split(" ")[1];
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const payload = verifyJwt(token);
  const userId = payload?.id;
  const { id } = params;

  if (!id || isNaN(parseInt(id))) {
    return NextResponse.json(
      { error: "유효하지 않은 ID입니다." },
      { status: 400 }
    );
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 공지사항 작성자 확인
    const [authorRows] = await connection.query(
      "SELECT author_id FROM notices WHERE id = ?",
      [id]
    );

    if ((authorRows as any[]).length === 0) {
      await connection.rollback();
      connection.release();
      return NextResponse.json(
        { error: "존재하지 않는 공지사항입니다." },
        { status: 404 }
      );
    }

    const authorId = (authorRows as any[])[0].author_id;
    // 작성자만 삭제 가능 (관리자 권한 확인 로직 추가 가능)
    if (authorId !== userId) {
      await connection.rollback();
      connection.release();
      return NextResponse.json(
        { error: "삭제 권한이 없습니다." },
        { status: 403 }
      );
    }

    // 연관 데이터 삭제 (이미지, 좋아요, 댓글)
    await connection.query("DELETE FROM notice_images WHERE notice_id = ?", [
      id,
    ]);

    await connection.query("DELETE FROM notice_likes WHERE notice_id = ?", [
      id,
    ]);

    // 댓글 삭제
    await connection.query("DELETE FROM notice_comments WHERE notice_id = ?", [
      id,
    ]);

    // 공지사항 삭제
    await connection.query("DELETE FROM notices WHERE id = ?", [id]);

    await connection.commit();
    connection.release();

    return NextResponse.json({
      success: true,
      message: "공지사항이 삭제되었습니다.",
    });
  } catch (error) {
    console.error("공지사항 삭제 오류:", error);
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    return NextResponse.json(
      { error: "공지사항 삭제에 실패했습니다." },
      { status: 500 }
    );
  }
}
