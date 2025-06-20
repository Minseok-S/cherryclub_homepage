import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../utils/db";
import { verifyJwt } from "../../../utils/jwt";

// 인증 헤더 상수
const AUTH_HEADER = "authorization";

/**
 * 간증 댓글 목록 조회 API
 * GET /api/testimonies/[id]/comments
 * @param request - NextRequest 객체
 * @param context - 라우트 매개변수를 포함하는 컨텍스트 객체
 * @returns 댓글 목록
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

    // 댓글 존재 여부 확인
    const [testimonyRows] = await connection.query(
      "SELECT id FROM testimonies WHERE id = ?",
      [id]
    );

    if ((testimonyRows as any[]).length === 0) {
      connection.release();
      return NextResponse.json(
        { error: "존재하지 않는 간증입니다." },
        { status: 404 }
      );
    }

    // 댓글 목록 조회 (계층형 구조) - testimony_comment_likes 테이블 사용
    const [commentsRows] = await connection.query(
      `SELECT 
        c.id, c.testimony_id, c.content, c.parent_id,
        c.created_at, c.updated_at, 
        c.like_count,
        u.id AS author_id, u.name AS author_name,
        univ.name AS author_school,
        EXISTS(SELECT 1 FROM testimony_comment_likes WHERE comment_id = c.id AND user_id = ?) AS is_liked
      FROM testimony_comments c
      JOIN users u ON c.author_id = u.id
      LEFT JOIN Universities univ ON u.universe_id = univ.id
      WHERE c.testimony_id = ?
      ORDER BY 
        CASE WHEN c.parent_id IS NULL THEN c.id ELSE c.parent_id END,
        c.parent_id IS NULL DESC,
        c.created_at ASC`,
      [userId || 0, id]
    );

    // 댓글과 대댓글 분리 및 계층 구조화
    const parentComments: any[] = [];
    const replyMap: { [key: string]: any[] } = {};

    (commentsRows as any[]).forEach((comment) => {
      comment.is_liked = !!comment.is_liked;

      if (comment.parent_id === null) {
        comment.replies = [];
        parentComments.push(comment);
        replyMap[comment.id] = comment.replies;
      } else {
        if (replyMap[comment.parent_id]) {
          replyMap[comment.parent_id].push(comment);
        }
      }
    });

    connection.release();

    return NextResponse.json({
      success: true,
      comments: parentComments,
    });
  } catch (error) {
    console.error("댓글 목록 조회 오류:", error);
    return NextResponse.json(
      { error: "댓글 목록 조회에 실패했습니다." },
      { status: 500 }
    );
  }
}

/**
 * 간증 댓글 작성 API
 * POST /api/testimonies/[id]/comments
 * @param request - 요청 객체 (댓글 내용, 부모 댓글 ID 포함)
 * @param context - 라우트 매개변수를 포함하는 컨텍스트 객체
 * @returns 생성된 댓글 정보
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

  // 요청 본문 파싱
  const body = await request.json();
  const { content, parent_id } = body;

  // 내용 유효성 검증
  if (!content) {
    return NextResponse.json(
      { error: "댓글 내용은 필수 항목입니다." },
      { status: 400 }
    );
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 간증 존재 여부 확인
    const [testimonyRows] = await connection.query(
      "SELECT id FROM testimonies WHERE id = ?",
      [id]
    );

    if ((testimonyRows as any[]).length === 0) {
      await connection.rollback();
      connection.release();
      return NextResponse.json(
        { error: "존재하지 않는 간증입니다." },
        { status: 404 }
      );
    }

    // 부모 댓글 존재 여부 확인 (있는 경우)
    if (parent_id) {
      const [parentRows] = await connection.query(
        "SELECT id, parent_id FROM testimony_comments WHERE id = ? AND testimony_id = ?",
        [parent_id, id]
      );

      if ((parentRows as any[]).length === 0) {
        await connection.rollback();
        connection.release();
        return NextResponse.json(
          { error: "존재하지 않는 부모 댓글입니다." },
          { status: 404 }
        );
      }

      // 대댓글의 부모는 최상위 댓글이어야 함 (3단계 이상 방지)
      if ((parentRows as any[])[0].parent_id !== null) {
        await connection.rollback();
        connection.release();
        return NextResponse.json(
          { error: "대댓글에는 답글을 달 수 없습니다." },
          { status: 400 }
        );
      }
    }

    // 댓글 작성
    const [result] = await connection.query(
      "INSERT INTO testimony_comments (testimony_id, content, author_id, parent_id) VALUES (?, ?, ?, ?)",
      [id, content, userId, parent_id || null]
    );

    const commentId = (result as any).insertId;

    // 생성된 댓글 조회 - testimony_comment_likes 테이블 사용
    const [commentRows] = await connection.query(
      `SELECT 
        c.id, c.testimony_id, c.content, c.parent_id,
        c.created_at, c.updated_at, 
        c.like_count,
        u.id AS author_id, u.name AS author_name,
        univ.name AS author_school,
        EXISTS(SELECT 1 FROM testimony_comment_likes WHERE comment_id = c.id AND user_id = ?) AS is_liked
      FROM testimony_comments c
      JOIN users u ON c.author_id = u.id
      LEFT JOIN Universities univ ON u.universe_id = univ.id
      WHERE c.id = ?`,
      [userId, commentId]
    );

    await connection.commit();
    connection.release();

    // is_liked 값을 boolean으로 변환
    const comment = (commentRows as any[])[0];
    comment.is_liked = !!comment.is_liked;

    return NextResponse.json({
      success: true,
      comment: comment,
    });
  } catch (error) {
    console.error("댓글 작성 오류:", error);
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    return NextResponse.json(
      { error: "댓글 작성에 실패했습니다." },
      { status: 500 }
    );
  }
}
