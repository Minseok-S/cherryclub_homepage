import { NextResponse } from "next/server";
import { pool } from "../../utils/db";
import { verifyJwt, signJwt, generateRefreshToken } from "../../utils/jwt";
import { AuthorityService } from "../../utils/authority-service";

/**
 * 리프레시 토큰으로 액세스 토큰을 재발급합니다.
 * @param {Object} req - { refreshToken: string }
 * @returns {Object} { success: true, token: string, refreshToken: string } 또는 { error: string }
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
 *       localStorage.setItem('refreshToken', data.refreshToken);
 *     }
 *   });
 */
export async function POST(request: Request) {
  let connection;
  try {
    const { refreshToken } = await request.json();

    console.log("=== 리프래시 토큰 처리 시작 ===");
    console.log(
      "받은 refreshToken:",
      refreshToken ? `${refreshToken.substring(0, 10)}...` : "null"
    );

    if (!refreshToken) {
      return NextResponse.json(
        { error: "리프레시 토큰이 필요합니다." },
        { status: 400 }
      );
    }

    // 리프래시 토큰 형식 검증 (64자 hex 문자열이어야 함)
    if (
      typeof refreshToken !== "string" ||
      refreshToken.length !== 64 ||
      !/^[a-fA-F0-9]+$/.test(refreshToken)
    ) {
      console.log("잘못된 리프래시 토큰 형식:", refreshToken);
      return NextResponse.json(
        { error: "잘못된 리프래시 토큰 형식입니다." },
        { status: 400 }
      );
    }

    // DB 연결 및 쿼리 실행
    connection = await pool.getConnection();

    console.log(
      "실행 쿼리: SELECT id, authority, refresh_token_expires_at FROM users WHERE refresh_token = ?"
    );

    // 쿼리 실행 (만료시간도 함께 조회)
    const [users] = await connection.query(
      "SELECT id, authority, refresh_token_expires_at FROM users WHERE refresh_token = ?",
      [refreshToken]
    );

    console.log(`검색된 사용자 수: ${(users as any[]).length}`);

    const user = (users as any[])[0];
    if (!user) {
      connection.release();

      // 디버깅을 위한 리프래시 토큰 샘플 조회 (처음 10자리만)
      const [allTokens] = await connection.query(
        "SELECT id, LEFT(refresh_token, 10) as token_prefix FROM users WHERE refresh_token IS NOT NULL LIMIT 5"
      );
      console.log("DB의 일부 리프레시 토큰 샘플 (앞 10자리):", allTokens);

      return NextResponse.json(
        { error: "유효하지 않은 리프레시 토큰입니다." },
        { status: 401 }
      );
    }

    // 리프래시 토큰 만료시간 확인
    if (user.refresh_token_expires_at) {
      const expiresAt = new Date(user.refresh_token_expires_at);
      const now = new Date();

      console.log(
        `리프래시 토큰 만료시간: ${expiresAt.toISOString()}, 현재시간: ${now.toISOString()}`
      );

      if (now > expiresAt) {
        console.log("리프래시 토큰이 만료됨");

        // 만료된 토큰 삭제
        await connection.query(
          "UPDATE users SET refresh_token = NULL, refresh_token_expires_at = NULL WHERE id = ?",
          [user.id]
        );

        connection.release();
        return NextResponse.json(
          { error: "리프래시 토큰이 만료되었습니다." },
          { status: 401 }
        );
      }
    }

    console.log("찾은 사용자:", { id: user.id, authority: user.authority });

    // 새로운 권한 구조 조회
    // Frontend Design Guideline의 Coupling 원칙에 따라 권한 로직을 분리된 서비스에서 처리
    const userAuthorities = await AuthorityService.getUserAuthorities(
      connection,
      user.id
    );

    // JWT 토큰에 사용할 권한 정보 결정
    // Predictability 원칙에 따라 일관된 형태로 권한 정보 제공
    let roleForJWT = "리더"; // 기본값
    if (userAuthorities && userAuthorities.authorities.length > 0) {
      // 가장 높은 권한(가장 낮은 level)을 JWT role로 사용
      roleForJWT = userAuthorities.authorities[0].display_name;
    }

    console.log(
      `사용자 권한 조회 완료: ${roleForJWT} (레벨: ${
        userAuthorities?.highestAuthorityLevel || 999
      })`
    );

    // 새 accessToken 발급 - 새로운 권한 구조 반영
    const token = signJwt({ id: user.id, role: roleForJWT });
    console.log("새 액세스 토큰 발급 성공");

    // 새 리프래시 토큰 발급 및 갱신 (보안 강화)
    const newRefreshToken = generateRefreshToken();
    const newRefreshTokenExpiresAt = new Date();
    newRefreshTokenExpiresAt.setDate(newRefreshTokenExpiresAt.getDate() + 30);

    console.log(
      `새 리프래시 토큰 발급: ${newRefreshToken.substring(
        0,
        10
      )}..., 만료시간: ${newRefreshTokenExpiresAt.toISOString()}`
    );

    await connection.query(
      "UPDATE users SET refresh_token = ?, refresh_token_expires_at = ? WHERE id = ?",
      [newRefreshToken, newRefreshTokenExpiresAt, user.id]
    );

    connection.release();

    console.log("=== 리프래시 토큰 처리 완료 ===");

    return NextResponse.json({
      success: true,
      token,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    console.error("리프레시 토큰 처리 중 오류:", error);
    if (connection) connection.release();
    return NextResponse.json({ error: "토큰 재발급 실패" }, { status: 500 });
  }
}
