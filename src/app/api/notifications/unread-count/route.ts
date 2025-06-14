import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../utils/db";
import { verifyJwt } from "../../utils/jwt";

/**
 * 읽지 않은 알림 개수 조회 API
 * GET /api/notifications/unread-count
 * @param request - NextRequest 객체
 * @returns 읽지 않은 알림 개수
 *
 * @description
 * Frontend Design Guideline 적용:
 * - Predictability: 일관된 응답 구조와 에러 처리
 * - Single Responsibility: 읽지 않은 알림 개수 조회만 담당
 * - Cohesion: 다른 알림 API들과 동일한 패턴 적용
 */
export async function GET(request: NextRequest) {
  // 인증 확인
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.split(" ")[1];
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const payload = verifyJwt(token);
  const userId = payload?.id;

  if (!userId) {
    return NextResponse.json(
      { error: "유효하지 않은 토큰입니다." },
      { status: 401 }
    );
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // 읽지 않은 알림 개수 조회
    const [rows] = await connection.execute(
      `SELECT COUNT(*) as count 
       FROM notifications 
       WHERE user_id = ? AND is_read = 0`,
      [userId]
    );

    const unreadCount = (rows as any[])[0]?.count || 0;

    return NextResponse.json({
      success: true,
      count: unreadCount,
      message: `읽지 않은 알림 ${unreadCount}개`,
    });
  } catch (error) {
    console.error("읽지 않은 알림 개수 조회 오류:", error);
    return NextResponse.json(
      {
        success: false,
        error: "읽지 않은 알림 개수 조회 중 오류가 발생했습니다.",
        count: 0,
      },
      { status: 500 }
    );
  } finally {
    if (connection) {
      connection.release();
    }
  }
}
