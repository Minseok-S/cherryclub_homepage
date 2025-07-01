import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../utils/db";
import { verifyJwt } from "../../utils/jwt";

/**
 * 모든 알림 읽음 처리 API
 * PATCH /api/notifications/read-all
 * @param request - NextRequest 객체
 * @returns 성공 여부 및 읽음 처리된 알림 수
 *
 * @description
 * Frontend Design Guideline 적용:
 * - Predictability: 일관된 응답 구조와 에러 처리
 * - Single Responsibility: 모든 알림 읽음 처리만 담당
 * - Cohesion: 관련 알림 기능과 동일한 패턴 적용
 */
export async function PATCH(request: NextRequest) {
  // 인증 확인
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.split(" ")[1];
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const payload = verifyJwt(token);
  const userId = payload?.id;

  let connection: any;
  try {
    connection = await pool.getConnection();

    // 해당 사용자의 모든 읽지 않은 알림을 읽음 처리
    const [updateResult] = await connection.query(
      "UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0",
      [userId]
    );

    const affectedRows = (updateResult as any).affectedRows;

    // 사용자의 현재 읽지 않은 알림 수 조회 (업데이트 후 0이어야 함)
    const [unreadCountRows] = await connection.query(
      "SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0",
      [userId]
    );
    const unreadCount = (unreadCountRows as any[])[0].count;

    connection.release();

    // Frontend Design Guideline: Predictability - 일관된 응답 구조
    return NextResponse.json({
      success: true,
      message: `${affectedRows}개의 알림이 읽음 처리되었습니다.`,
      processed_count: affectedRows,
      unread_count: unreadCount,
    });
  } catch (error) {
    console.error("모든 알림 읽음 처리 오류:", error);
    if (connection) connection.release();

    // Frontend Design Guideline: Predictability - 일관된 에러 응답
    return NextResponse.json(
      { error: "모든 알림 읽음 처리에 실패했습니다." },
      { status: 500 }
    );
  }
}
