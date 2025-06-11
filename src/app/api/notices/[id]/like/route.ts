import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../utils/db";
import { verifyJwt } from "../../../utils/jwt";

// 인증 헤더 상수
const AUTH_HEADER = "authorization";

/**
 * 공지사항 좋아요 토글 API
 * POST /api/notices/[id]/like
 * @param request - NextRequest 객체
 * @param params - URL 파라미터 (id)
 * @returns 좋아요 상태 정보
 */
export async function POST(
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

    // 공지사항 존재 여부 확인
    const [noticeRows] = await connection.query(
      "SELECT id FROM notices WHERE id = ?",
      [id]
    );

    if ((noticeRows as any[]).length === 0) {
      await connection.rollback();
      connection.release();
      return NextResponse.json(
        { error: "존재하지 않는 공지사항입니다." },
        { status: 404 }
      );
    }

    // 좋아요 상태 확인
    const [likeRows] = await connection.query(
      "SELECT id FROM notice_likes WHERE notice_id = ? AND user_id = ?",
      [id, userId]
    );

    const isLiked = (likeRows as any[]).length > 0;

    if (isLiked) {
      // 좋아요 취소
      await connection.query(
        "DELETE FROM notice_likes WHERE notice_id = ? AND user_id = ?",
        [id, userId]
      );

      // 좋아요 수 감소
      await connection.query(
        "UPDATE notices SET like_count = GREATEST(like_count - 1, 0) WHERE id = ?",
        [id]
      );
    } else {
      // 좋아요 추가
      await connection.query(
        "INSERT INTO notice_likes (notice_id, user_id) VALUES (?, ?)",
        [id, userId]
      );

      // 좋아요 수 증가
      await connection.query(
        "UPDATE notices SET like_count = like_count + 1 WHERE id = ?",
        [id]
      );
    }

    // 최종 좋아요 수 조회
    const [updateRows] = await connection.query(
      "SELECT like_count FROM notices WHERE id = ?",
      [id]
    );

    await connection.commit();
    connection.release();

    return NextResponse.json({
      success: true,
      liked: !isLiked,
      like_count: (updateRows as any[])[0].like_count,
    });
  } catch (error) {
    console.error("공지사항 좋아요 토글 오류:", error);
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    return NextResponse.json(
      { error: "공지사항 좋아요 처리에 실패했습니다." },
      { status: 500 }
    );
  }
}
