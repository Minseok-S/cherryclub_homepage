import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../utils/db";
import { verifyJwt } from "../../utils/jwt";

// 인증 헤더 상수
const AUTH_HEADER = "authorization";

/**
 * 간증 상세 조회 API
 * GET /api/testimonies/[id]
 * @param request - NextRequest 객체
 * @param context - 라우트 매개변수를 포함하는 컨텍스트 객체
 * @returns 간증 상세 정보
 *
 * @description
 * Frontend Design Guideline 적용:
 * - Predictability: 공지사항과 동일한 구조로 일관된 응답 형식
 * - Single Responsibility: 간증 상세 조회만 담당
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
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
      "UPDATE testimonies SET view_count = view_count + 1 WHERE id = ?",
      [id]
    );

    // 간증 상세 조회 (카테고리 및 HOT 게시글 정보 포함)
    const [testimonyRows] = await connection.query(
      `SELECT 
        t.id, t.category, t.content, 
        t.created_at, t.updated_at, 
        t.view_count, t.like_count, 
        (SELECT COUNT(*) FROM testimony_comments WHERE testimony_id = t.id) AS comment_count,
        u.id AS author_id, u.name AS author_name,
        univ.name AS author_school,
        EXISTS(SELECT 1 FROM testimony_likes WHERE testimony_id = t.id AND user_id = ?) AS is_liked,
        CASE 
          WHEN t.like_count >= 10 THEN 1 
          ELSE 0 
        END AS is_hot
      FROM testimonies t
      JOIN users u ON t.author_id = u.id
      LEFT JOIN Universities univ ON u.universe_id = univ.id
      WHERE t.id = ?`,
      [userId || 0, id]
    );

    if ((testimonyRows as any[]).length === 0) {
      connection.release();
      return NextResponse.json(
        { error: "존재하지 않는 간증입니다." },
        { status: 404 }
      );
    }

    // 이미지 조회
    const [imageRows] = await connection.query(
      "SELECT image_url FROM testimony_images WHERE testimony_id = ?",
      [id]
    );

    // 간증 객체 구성
    const testimony = {
      ...(testimonyRows as any[])[0],
      image_urls: (imageRows as any[]).map((img) => img.image_url),
      is_liked: !!(testimonyRows as any[])[0].is_liked,
    };

    connection.release();

    return NextResponse.json({
      success: true,
      testimony,
    });
  } catch (error) {
    console.error("간증 상세 조회 오류:", error);
    return NextResponse.json(
      { error: "간증 상세 조회에 실패했습니다." },
      { status: 500 }
    );
  }
}

/**
 * 간증 수정 API
 * PUT /api/testimonies/[id]
 * @param request - 요청 객체 (카테고리, 내용, 이미지 포함)
 * @param context - 라우트 매개변수를 포함하는 컨텍스트 객체
 * @returns 수정된 간증 정보
 *
 * @description
 * Frontend Design Guideline 적용:
 * - Single Responsibility: 간증 수정만 담당
 * - Predictability: 공지사항과 동일한 구조로 일관된 처리
 */
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // 인증 확인
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = authHeader?.split(" ")[1];
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const payload = verifyJwt(token);
  const userId = payload?.id;
  const { id } = await context.params;

  if (!id || isNaN(parseInt(id))) {
    return NextResponse.json(
      { error: "유효하지 않은 ID입니다." },
      { status: 400 }
    );
  }

  // JSON 파싱 (Flutter에서 Firebase Storage URLs 전송)
  const body = await request.json();
  const { category, content, image_urls } = body;

  // 이미지 URLs (Firebase Storage에 이미 업로드된 상태)
  const imageUrls = image_urls || [];

  // 카테고리 및 내용 유효성 검증
  if (!category || !content) {
    return NextResponse.json(
      { error: "카테고리와 내용은 필수 항목입니다." },
      { status: 400 }
    );
  }

  // 카테고리 유효성 검증 (Flutter와 동일한 값들)
  const validCategories = ["campus", "camp", "meeting", "etc"];
  if (!validCategories.includes(category)) {
    return NextResponse.json(
      { error: "유효하지 않은 카테고리입니다." },
      { status: 400 }
    );
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 간증 작성자 확인
    const [authorRows] = await connection.query(
      "SELECT author_id FROM testimonies WHERE id = ?",
      [id]
    );

    if ((authorRows as any[]).length === 0) {
      await connection.rollback();
      connection.release();
      return NextResponse.json(
        { error: "존재하지 않는 간증입니다." },
        { status: 404 }
      );
    }

    const authorId = (authorRows as any[])[0].author_id;
    const isAuthor = authorId === userId;

    // 새로운 권한 체제로 관리자 권한 확인
    const [adminRows] = await connection.query(
      `SELECT EXISTS(
        SELECT 1 FROM user_authorities ua 
        JOIN authorities a ON ua.authority_id = a.id 
        WHERE ua.user_id = ? AND a.name IN ('ADMIN', 'NCMN_STAFF', 'LEADERSHIP', 'BRANCH_DIRECTOR')
      ) AS is_admin`,
      [userId]
    );
    const isAdmin = !!(adminRows as any[])[0].is_admin;

    if (!isAuthor && !isAdmin) {
      await connection.rollback();
      connection.release();
      return NextResponse.json(
        { error: "수정 권한이 없습니다." },
        { status: 403 }
      );
    }

    // 간증 수정 (카테고리 포함)
    await connection.query(
      "UPDATE testimonies SET category = ?, content = ?, updated_at = NOW() WHERE id = ?",
      [category, content, id]
    );

    // 기존 이미지 모두 삭제 후 새로운 이미지 URLs로 교체
    await connection.query(
      "DELETE FROM testimony_images WHERE testimony_id = ?",
      [id]
    );

    // 새로운 이미지 URLs 저장 (Firebase Storage에 이미 업로드된 상태)
    if (imageUrls.length > 0) {
      for (const imageUrl of imageUrls) {
        await connection.query(
          "INSERT INTO testimony_images (testimony_id, image_url) VALUES (?, ?)",
          [id, imageUrl]
        );
      }
    }

    // 수정된 간증 조회 (카테고리 및 HOT 게시글 정보 포함)
    const [testimonyRows] = await connection.query(
      `SELECT 
        t.id, t.category, t.content, 
        t.created_at, t.updated_at, 
        t.view_count, t.like_count, 
        (SELECT COUNT(*) FROM testimony_comments WHERE testimony_id = t.id) AS comment_count,
        u.id AS author_id, u.name AS author_name,
        univ.name AS author_school,
        EXISTS(SELECT 1 FROM testimony_likes WHERE testimony_id = t.id AND user_id = ?) AS is_liked,
        CASE 
          WHEN t.like_count >= 10 THEN 1 
          ELSE 0 
        END AS is_hot
      FROM testimonies t
      JOIN users u ON t.author_id = u.id
      LEFT JOIN Universities univ ON u.universe_id = univ.id
      WHERE t.id = ?`,
      [userId, id]
    );

    // 이미지 조회
    const [imageRows] = await connection.query(
      "SELECT image_url FROM testimony_images WHERE testimony_id = ?",
      [id]
    );

    await connection.commit();
    connection.release();

    // 간증 객체 구성
    const testimony = {
      ...(testimonyRows as any[])[0],
      image_urls: (imageRows as any[]).map((img) => img.image_url),
      is_liked: !!(testimonyRows as any[])[0].is_liked,
    };

    return NextResponse.json({
      success: true,
      testimony,
    });
  } catch (error) {
    console.error("간증 수정 오류:", error);
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    return NextResponse.json(
      { error: "간증 수정에 실패했습니다." },
      { status: 500 }
    );
  }
}

/**
 * 간증 삭제 API
 * DELETE /api/testimonies/[id]
 * @param request - NextRequest 객체
 * @param context - 라우트 매개변수를 포함하는 컨텍스트 객체
 * @returns 성공 여부
 *
 * @description
 * Frontend Design Guideline 적용:
 * - Single Responsibility: 간증 삭제만 담당
 * - Predictability: 일관된 에러 처리와 응답 구조
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // 인증 확인
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = authHeader?.split(" ")[1];
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const payload = verifyJwt(token);
  const userId = payload?.id;
  const { id } = await context.params;

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

    // 간증 작성자 확인
    const [authorRows] = await connection.query(
      "SELECT author_id FROM testimonies WHERE id = ?",
      [id]
    );

    if ((authorRows as any[]).length === 0) {
      await connection.rollback();
      connection.release();
      return NextResponse.json(
        { error: "존재하지 않는 간증입니다." },
        { status: 404 }
      );
    }

    const authorId = (authorRows as any[])[0].author_id;
    const isAuthor = authorId === userId;

    // 새로운 권한 체제로 관리자 권한 확인
    const [adminRows] = await connection.query(
      `SELECT EXISTS(
        SELECT 1 FROM user_authorities ua 
        JOIN authorities a ON ua.authority_id = a.id 
        WHERE ua.user_id = ? AND a.name IN ('ADMIN', 'NCMN_STAFF', 'LEADERSHIP', 'BRANCH_DIRECTOR')
      ) AS is_admin`,
      [userId]
    );
    const isAdmin = !!(adminRows as any[])[0].is_admin;

    if (!isAuthor && !isAdmin) {
      await connection.rollback();
      connection.release();
      return NextResponse.json(
        { error: "삭제 권한이 없습니다." },
        { status: 403 }
      );
    }

    // 연관 데이터 삭제 (이미지, 좋아요, 댓글)
    await connection.query(
      "DELETE FROM testimony_images WHERE testimony_id = ?",
      [id]
    );

    await connection.query(
      "DELETE FROM testimony_likes WHERE testimony_id = ?",
      [id]
    );

    // 댓글 삭제 (대댓글부터 먼저 삭제)
    // Frontend Design Guideline의 Predictability 원칙: 외래키 제약을 고려한 순서대로 삭제
    await connection.query(
      "DELETE FROM testimony_comments WHERE testimony_id = ? AND parent_id IS NOT NULL",
      [id]
    );
    // 그 다음 부모 댓글 삭제
    await connection.query(
      "DELETE FROM testimony_comments WHERE testimony_id = ? AND parent_id IS NULL",
      [id]
    );

    // 간증 삭제
    await connection.query("DELETE FROM testimonies WHERE id = ?", [id]);

    await connection.commit();
    connection.release();

    return NextResponse.json({
      success: true,
      message: "간증이 삭제되었습니다.",
    });
  } catch (error) {
    console.error("간증 삭제 오류:", error);
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    return NextResponse.json(
      { error: "간증 삭제에 실패했습니다." },
      { status: 500 }
    );
  }
}
