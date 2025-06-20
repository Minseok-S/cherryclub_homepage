import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../utils/db";
import { verifyJwt } from "../../../utils/jwt";

// 인증 헤더 상수
const AUTH_HEADER = "authorization";

/**
 * 간증 댓글 좋아요 토글 API
 * POST /api/testimony-comments/[id]/like
 * @param request - NextRequest 객체
 * @param context - 라우트 매개변수를 포함하는 컨텍스트 객체
 * @returns 좋아요 상태 정보
 */
export async function POST(
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

    // 댓글 존재 여부 확인
    const [commentRows] = await connection.query(
      "SELECT id, author_id FROM testimony_comments WHERE id = ?",
      [id]
    );

    if ((commentRows as any[]).length === 0) {
      await connection.rollback();
      connection.release();
      return NextResponse.json(
        { error: "존재하지 않는 댓글입니다." },
        { status: 404 }
      );
    }

    // 간증 댓글 좋아요 테이블 생성 (존재하지 않는 경우)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS testimony_comment_likes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        comment_id INT NOT NULL,
        user_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_testimony_comment_like (comment_id, user_id),
        FOREIGN KEY (comment_id) REFERENCES testimony_comments(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // 좋아요 상태 확인 (간증 댓글 좋아요 테이블 사용)
    const [likeRows] = await connection.query(
      "SELECT id FROM testimony_comment_likes WHERE comment_id = ? AND user_id = ?",
      [id, userId]
    );

    const isLiked = (likeRows as any[]).length > 0;
    const commentData = (commentRows as any[])[0];

    if (isLiked) {
      // 좋아요 취소
      await connection.query(
        "DELETE FROM testimony_comment_likes WHERE comment_id = ? AND user_id = ?",
        [id, userId]
      );

      // 좋아요 수 감소
      await connection.query(
        "UPDATE testimony_comments SET like_count = GREATEST(like_count - 1, 0) WHERE id = ?",
        [id]
      );
    } else {
      // 좋아요 추가
      await connection.query(
        "INSERT INTO testimony_comment_likes (comment_id, user_id) VALUES (?, ?)",
        [id, userId]
      );

      // 좋아요 수 증가
      await connection.query(
        "UPDATE testimony_comments SET like_count = like_count + 1 WHERE id = ?",
        [id]
      );

      // 좋아요 알림 생성 (자기 자신에게는 알림 보내지 않음)
      try {
        if (commentData.author_id !== userId) {
          await connection.query(
            `INSERT INTO notifications (user_id, title, message, type, related_id, created_at, is_read) 
             VALUES (?, ?, ?, ?, ?, NOW(), 0)`,
            [
              commentData.author_id,
              "댓글 좋아요",
              "회원님의 간증 댓글에 좋아요를 눌렀습니다.",
              "comment_like",
              id,
            ]
          );
        }
      } catch (notificationError) {
        console.error("간증 댓글 좋아요 알림 생성 실패:", notificationError);
        // 알림 생성 실패해도 핵심 기능에는 영향 없음
      }
    }

    // 최종 좋아요 수 조회
    const [updateRows] = await connection.query(
      "SELECT like_count FROM testimony_comments WHERE id = ?",
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
    console.error("댓글 좋아요 토글 오류:", error);
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    return NextResponse.json(
      { error: "댓글 좋아요 처리에 실패했습니다." },
      { status: 500 }
    );
  }
}
