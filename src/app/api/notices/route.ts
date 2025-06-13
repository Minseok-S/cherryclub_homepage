import { NextRequest, NextResponse } from "next/server";
import { pool } from "../utils/db";
import { verifyJwt } from "../utils/jwt";

// 인증 헤더 상수
const AUTH_HEADER = "authorization";

/**
 * 공지사항 목록 조회 API
 * GET /api/notices?page=1&page_size=10
 * @param request - NextRequest 객체
 * @returns 공지사항 목록
 */
export async function GET(request: NextRequest) {
  try {
    // 페이지네이션 파라미터
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const pageSize = parseInt(searchParams.get("page_size") || "10");

    // 페이지 및 사이즈 유효성 검증
    if (isNaN(page) || isNaN(pageSize) || page < 1 || pageSize < 1) {
      return NextResponse.json(
        { error: "유효하지 않은 페이지 파라미터입니다." },
        { status: 400 }
      );
    }

    // 인증 확인 (선택적)
    const authHeader = request.headers.get(AUTH_HEADER);
    const token = authHeader?.split(" ")[1];
    const userId = token ? verifyJwt(token)?.id : null;

    const connection = await pool.getConnection();

    // 페이징 처리를 위한 offset 계산
    const offset = (page - 1) * pageSize;

    // 공지사항 목록 조회 (최신순 정렬)
    const [noticesRows] = await connection.query(
      `SELECT 
        n.id, n.title, LEFT(n.content, 200) AS content, 
        n.created_at, n.updated_at, 
        n.view_count, n.like_count, 
        (SELECT COUNT(*) FROM notice_comments WHERE notice_id = n.id) AS comment_count,
        u.id AS author_id, u.name AS author_name,
        univ.name AS author_school,
        n.is_pinned,
        EXISTS(SELECT 1 FROM notice_likes WHERE notice_id = n.id AND user_id = ?) AS is_liked
      FROM notices n
      JOIN users u ON n.author_id = u.id
      LEFT JOIN Universities univ ON u.universe_id = univ.id
      ORDER BY n.is_pinned DESC, n.created_at DESC
      LIMIT ? OFFSET ?`,
      [userId || 0, pageSize, offset]
    );

    // 각 공지사항에 대한 이미지 조회
    const notices = [];
    for (const notice of noticesRows as any[]) {
      const [imageRows] = await connection.query(
        "SELECT image_url FROM notice_images WHERE notice_id = ?",
        [notice.id]
      );

      notices.push({
        ...notice,
        image_urls: (imageRows as any[]).map((img) => img.image_url),
        is_liked: !!notice.is_liked,
      });
    }

    connection.release();

    return NextResponse.json({
      success: true,
      notices,
      pagination: {
        page,
        page_size: pageSize,
        has_more: notices.length === pageSize,
      },
    });
  } catch (error) {
    console.error("공지사항 목록 조회 오류:", error);
    return NextResponse.json(
      { error: "공지사항 목록 조회에 실패했습니다." },
      { status: 500 }
    );
  }
}

/**
 * 공지사항 생성 API
 * POST /api/notices
 * @param request - 요청 객체 (제목, 내용, 이미지 포함)
 * @returns 생성된 공지사항 정보
 */
export async function POST(request: NextRequest) {
  // 인증 확인
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = authHeader?.split(" ")[1];
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const payload = verifyJwt(token);
  const userId = payload?.id;

  // FormData 파싱
  const formData = await request.formData();
  const title = formData.get("title") as string;
  const content = formData.get("content") as string;
  const isPinned = formData.get("is_pinned") === "true";

  // 이미지 파일들
  const images = formData.getAll("images") as File[];

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

    // 공지사항 생성
    const [result] = await connection.query(
      "INSERT INTO notices (title, content, author_id, is_pinned) VALUES (?, ?, ?, ?)",
      [title, content, userId, isPinned ? 1 : 0]
    );
    const noticeId = (result as any).insertId;

    // 이미지 처리 (이미지가 있는 경우)
    if (images.length > 0) {
      // 이미지 저장 로직 (실제로는 이미지 업로드 서비스 사용 필요)
      for (const image of images) {
        const buffer = Buffer.from(await image.arrayBuffer());
        // 이미지 저장 로직 (예시)
        // const imageUrl = await uploadImageToStorage(buffer, image.name);

        // 임시로 이미지 URL 생성
        const imageUrl = `/uploads/notices/${noticeId}/${image.name}`;

        // 이미지 정보 DB 저장
        await connection.query(
          "INSERT INTO notice_images (notice_id, image_url) VALUES (?, ?)",
          [noticeId, imageUrl]
        );
      }
    }

    // 생성된 공지사항 조회
    const [noticeRows] = await connection.query(
      `SELECT 
        n.id, n.title, n.content, 
        n.created_at, n.updated_at, 
        n.view_count, n.like_count, 
        (SELECT COUNT(*) FROM notice_comments WHERE notice_id = n.id) AS comment_count,
        u.id AS author_id, u.name AS author_name,
        univ.name AS author_school,
        n.is_pinned,
        0 AS is_liked
      FROM notices n
      JOIN users u ON n.author_id = u.id
      LEFT JOIN Universities univ ON u.universe_id = univ.id
      WHERE n.id = ?`,
      [noticeId]
    );

    // 이미지 조회
    const [imageRows] = await connection.query(
      "SELECT image_url FROM notice_images WHERE notice_id = ?",
      [noticeId]
    );

    await connection.commit();
    connection.release();

    // 공지사항 객체 구성
    const notice = {
      ...(noticeRows as any[])[0],
      image_urls: (imageRows as any[]).map((img) => img.image_url),
      is_liked: false,
    };

    return NextResponse.json({
      success: true,
      notice,
    });
  } catch (error) {
    console.error("공지사항 생성 오류:", error);
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    return NextResponse.json(
      { error: "공지사항 생성에 실패했습니다." },
      { status: 500 }
    );
  }
}
