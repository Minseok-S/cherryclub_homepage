import { NextRequest, NextResponse } from "next/server";
import { pool } from "../utils/db";
import { verifyJwt } from "../utils/jwt";

// 인증 헤더 상수
const AUTH_HEADER = "authorization";

/**
 * 알림 목록 조회 API
 * GET /api/notifications?page=1&page_size=20
 * @param request - NextRequest 객체
 * @returns 알림 목록
 */
export async function GET(request: NextRequest) {
  // 인증 확인
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = authHeader?.split(" ")[1];
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const payload = verifyJwt(token);
  const userId = payload?.id;

  // 페이지네이션 파라미터
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1");
  const pageSize = parseInt(searchParams.get("page_size") || "20");

  // 페이지 및 사이즈 유효성 검증
  if (isNaN(page) || isNaN(pageSize) || page < 1 || pageSize < 1) {
    return NextResponse.json(
      { error: "유효하지 않은 페이지 파라미터입니다." },
      { status: 400 }
    );
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // 페이징 처리를 위한 offset 계산
    const offset = (page - 1) * pageSize;

    // 알림 목록 조회 (최신순 정렬)
    const [notificationsRows] = await connection.query(
      `SELECT 
        id, title, message, type, created_at, is_read, 
        related_id, sender_id, sender_name
      FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
      [userId, pageSize, offset]
    );

    // 읽지 않은 알림 개수 조회
    const [unreadRows] = await connection.query(
      "SELECT COUNT(*) AS unread_count FROM notifications WHERE user_id = ? AND is_read = 0",
      [userId]
    );

    const unreadCount = (unreadRows as any[])[0].unread_count;

    connection.release();

    return NextResponse.json({
      success: true,
      notifications: notificationsRows,
      pagination: {
        page,
        page_size: pageSize,
        has_more: (notificationsRows as any[]).length === pageSize,
      },
      unread_count: unreadCount,
    });
  } catch (error) {
    console.error("알림 목록 조회 오류:", error);
    if (connection) connection.release();
    return NextResponse.json(
      { error: "알림 목록 조회에 실패했습니다." },
      { status: 500 }
    );
  }
}

/**
 * FCM 토큰 업데이트 API
 * POST /api/notifications/fcm-token
 * @param request - 요청 객체 (FCM 토큰 포함)
 * @returns 성공 여부
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

  // 요청 본문 파싱
  const body = await request.json();
  const { fcm_token } = body;

  // FCM 토큰 유효성 검증
  if (!fcm_token) {
    return NextResponse.json(
      { error: "FCM 토큰은 필수 항목입니다." },
      { status: 400 }
    );
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // FCM 토큰 업데이트
    await connection.query("UPDATE users SET fcm_token = ? WHERE id = ?", [
      fcm_token,
      userId,
    ]);

    connection.release();

    return NextResponse.json({
      success: true,
      message: "FCM 토큰이 업데이트되었습니다.",
    });
  } catch (error) {
    console.error("FCM 토큰 업데이트 오류:", error);
    if (connection) connection.release();
    return NextResponse.json(
      { error: "FCM 토큰 업데이트에 실패했습니다." },
      { status: 500 }
    );
  }
}
