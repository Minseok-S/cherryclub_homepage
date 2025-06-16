import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../utils/db";
import { verifyJwt } from "../../utils/jwt";

// 인증 헤더 상수
const AUTH_HEADER = "authorization";

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
  const { token: fcm_token } = body;

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
