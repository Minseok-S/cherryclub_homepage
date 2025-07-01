import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../utils/db";
import { verifyJwt } from "../../../utils/jwt";

/**
 * 알림 읽음 처리 API
 * PATCH /api/notifications/[id]/read
 * @param request - NextRequest 객체
 * @param context - 라우트 매개변수
 * @returns 성공 여부 및 업데이트된 뱃지 수
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // 인증 확인
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.split(" ")[1];
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const payload = verifyJwt(token);
  const userId = payload?.id;

  // params 파라미터 추출
  const { id } = await context.params;

  let connection: any;
  try {
    connection = await pool.getConnection();

    // 해당 알림이 사용자의 것인지 확인하고 읽음 처리
    const [updateResult] = await connection.query(
      "UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ? AND is_read = 0",
      [id, userId]
    );

    if ((updateResult as any).affectedRows === 0) {
      connection.release();
      return NextResponse.json(
        { error: "알림을 찾을 수 없거나 이미 읽음 처리되었습니다." },
        { status: 404 }
      );
    }

    // 사용자의 읽지 않은 알림 수 조회 (iOS 뱃지용)
    const [unreadCountRows] = await connection.query(
      "SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0",
      [userId]
    );
    const unreadCount = (unreadCountRows as any[])[0].count;

    connection.release();

    return NextResponse.json({
      success: true,
      message: "알림이 읽음 처리되었습니다.",
      unread_count: unreadCount,
    });
  } catch (error) {
    console.error("알림 읽음 처리 오류:", error);
    if (connection) connection.release();
    return NextResponse.json(
      { error: "알림 읽음 처리에 실패했습니다." },
      { status: 500 }
    );
  }
}
