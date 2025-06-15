import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../utils/db";
import { verifyJwt } from "../../utils/jwt";

// 인증 헤더 상수
const AUTH_HEADER = "authorization";

/**
 * 간증 댓글 수정 API
 * PATCH /api/testimony-comments/[id]
 * @param request - 요청 객체 (댓글 내용 포함)
 * @param context - 라우트 매개변수를 포함하는 컨텍스트 객체
 * @returns 수정된 댓글 정보
 */
export async function PATCH(
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
  const { content } = body;

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

    // 댓글 존재 여부 및 작성자 확인
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

    const authorId = (commentRows as any[])[0].author_id;
    // 작성자만 수정 가능 (관리자 권한 확인 로직 추가 가능)
    if (authorId !== userId) {
      await connection.rollback();
      connection.release();
      return NextResponse.json(
        { error: "수정 권한이 없습니다." },
        { status: 403 }
      );
    }

    // 댓글 수정
    await connection.query(
      "UPDATE testimony_comments SET content = ?, updated_at = NOW() WHERE id = ?",
      [content, id]
    );

    // 수정된 댓글 조회
    const [updatedRows] = await connection.query(
      `SELECT 
        c.id, c.testimony_id, c.content, c.parent_id,
        c.created_at, c.updated_at, 
        c.like_count,
        u.id AS author_id, u.name AS author_name,
        univ.name AS author_school,
        EXISTS(SELECT 1 FROM comment_likes WHERE comment_id = c.id AND user_id = ?) AS is_liked
      FROM testimony_comments c
      JOIN users u ON c.author_id = u.id
      LEFT JOIN Universities univ ON u.universe_id = univ.id
      WHERE c.id = ?`,
      [userId, id]
    );

    await connection.commit();
    connection.release();

    const comment = {
      ...(updatedRows as any[])[0],
      is_liked: !!(updatedRows as any[])[0].is_liked,
    };

    return NextResponse.json({
      success: true,
      comment,
    });
  } catch (error) {
    console.error("댓글 수정 오류:", error);
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    return NextResponse.json(
      { error: "댓글 수정에 실패했습니다." },
      { status: 500 }
    );
  }
}

/**
 * 간증 댓글 삭제 API
 * DELETE /api/testimony-comments/[id]
 * @param request - NextRequest 객체
 * @param context - 라우트 매개변수를 포함하는 컨텍스트 객체
 * @returns 성공 여부
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

    // 댓글 존재 여부 및 작성자 확인
    const [commentRows] = await connection.query(
      "SELECT id, author_id, parent_id FROM testimony_comments WHERE id = ?",
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

    const authorId = (commentRows as any[])[0].author_id;
    const parentId = (commentRows as any[])[0].parent_id;

    // 작성자만 삭제 가능 (관리자 권한 확인 로직 추가 가능)
    if (authorId !== userId) {
      await connection.rollback();
      connection.release();
      return NextResponse.json(
        { error: "삭제 권한이 없습니다." },
        { status: 403 }
      );
    }

    // 대댓글이 있는지 확인 (최상위 댓글인 경우)
    if (parentId === null) {
      const [repliesRows] = await connection.query(
        "SELECT COUNT(*) AS reply_count FROM testimony_comments WHERE parent_id = ?",
        [id]
      );

      const replyCount = (repliesRows as any[])[0].reply_count;

      // 대댓글이 있는 경우 삭제하지 않고 내용만 변경
      if (replyCount > 0) {
        await connection.query(
          "UPDATE testimony_comments SET content = '삭제된 댓글입니다.', updated_at = NOW() WHERE id = ?",
          [id]
        );

        await connection.commit();
        connection.release();

        return NextResponse.json({
          success: true,
          message: "댓글이 삭제되었습니다 (대댓글 존재로 내용만 변경).",
        });
      }
    }

    // 좋아요 삭제
    await connection.query("DELETE FROM comment_likes WHERE comment_id = ?", [
      id,
    ]);

    // 댓글 삭제
    await connection.query("DELETE FROM testimony_comments WHERE id = ?", [id]);

    await connection.commit();
    connection.release();

    return NextResponse.json({
      success: true,
      message: "댓글이 삭제되었습니다.",
    });
  } catch (error) {
    console.error("댓글 삭제 오류:", error);
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    return NextResponse.json(
      { error: "댓글 삭제에 실패했습니다." },
      { status: 500 }
    );
  }
}
