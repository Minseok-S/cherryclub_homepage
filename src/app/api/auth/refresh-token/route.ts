import { NextResponse } from "next/server";
import { pool } from "../../utils/db";
import { signJwt } from "../../utils/jwt";

/**
 * 리프레시 토큰으로 액세스 토큰을 재발급합니다.
 * @param {Object} req - { refreshToken: string }
 * @returns {Object} { success: true, token: string } 또는 { error: string }
 * @example
 * fetch('/api/auth/refresh-token', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({ refreshToken })
 * })
 *   .then(res => res.json())
 *   .then(data => {
 *     if (data.success) {
 *       localStorage.setItem('token', data.token);
 *     }
 *   });
 */
export async function POST(request: Request) {
  try {
    const { refreshToken } = await request.json();
    if (!refreshToken) {
      return NextResponse.json(
        { error: "리프레시 토큰이 필요합니다." },
        { status: 400 }
      );
    }

    console.log("refreshToken", refreshToken);
    const connection = await pool.getConnection();
    const [users] = await connection.query(
      "SELECT * FROM users WHERE refresh_token = ?",
      [refreshToken]
    );
    const user = (users as any[])[0];
    if (!user) {
      connection.release();
      return NextResponse.json(
        { error: "유효하지 않은 리프레시 토큰입니다." },
        { status: 401 }
      );
    }

    console.log("user", user);
    // 새 accessToken 발급
    const token = signJwt({ id: user.id, role: user.authority });
    connection.release();
    return NextResponse.json({ success: true, token });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "토큰 재발급 실패" }, { status: 500 });
  }
}
