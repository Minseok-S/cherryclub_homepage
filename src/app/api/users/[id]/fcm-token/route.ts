/**
 * @function PATCH
 * @description 특정 유저의 FCM 토큰을 업데이트합니다. (로그인 필요)
 * @param {Request} request - 인증 토큰 및 { fcm_token: string } 포함 요청
 * @returns {Object} { success: boolean, message?: string }
 * @example
 * fetch('/api/users/1/fcm-token', {
 *   method: 'PATCH',
 *   headers: { 'Content-Type': 'application/json', 'authorization': 'Bearer ...' },
 *   body: JSON.stringify({ fcm_token: 'new_token_here' })
 * })
 *   .then(res => res.json())
 *   .then(data => console.log(data));
 */
import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../utils/db";
import { verifyJwt } from "../../../utils/jwt";

const AUTH_HEADER = "authorization";

export async function PATCH(request: NextRequest) {
  let connection;
  try {
    // URL에서 id 추출
    const url = new URL(request.url);
    const pathParts = url.pathname.split("/");
    const userIndex = pathParts.indexOf("users");
    const id = pathParts[userIndex + 1];

    // 1. JWT 인증
    const authHeader = request.headers.get(AUTH_HEADER);
    const token = authHeader?.split(" ")[1];
    if (!token) {
      return NextResponse.json(
        { success: false, message: "인증 토큰이 필요합니다." },
        { status: 401 }
      );
    }
    const payload = verifyJwt(token);
    if (!payload) {
      return NextResponse.json(
        { success: false, message: "인증토큰이 만료되었습니다." },
        { status: 401 }
      );
    }

    // 2. 파라미터 및 바디 파싱
    const userId = Number(id);
    if (!userId) {
      return NextResponse.json(
        { success: false, message: "유저 id가 올바르지 않습니다." },
        { status: 400 }
      );
    }
    const { fcm_token } = await request.json();
    if (!fcm_token || typeof fcm_token !== "string") {
      return NextResponse.json(
        { success: false, message: "fcm_token이 필요합니다." },
        { status: 400 }
      );
    }

    // 3. DB 업데이트
    connection = await pool.getConnection();
    const [result] = await connection.query(
      `UPDATE users SET fcm_token = ? WHERE id = ?`,
      [fcm_token, userId]
    );
    connection.release();

    // 4. 결과 반환
    return NextResponse.json({ success: true });
  } catch (error) {
    if (connection) connection.release();
    console.error("FCM 토큰 업데이트 오류:", error);
    return NextResponse.json(
      { success: false, message: "FCM 토큰 업데이트 실패" },
      { status: 500 }
    );
  }
}
