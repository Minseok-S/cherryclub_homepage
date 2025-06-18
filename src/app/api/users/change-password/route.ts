import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { pool } from "../../utils/db";
import { verifyJwt } from "../../utils/jwt";

// 인증 헤더 상수
const AUTH_HEADER = "authorization";
const BCRYPT_SALT_ROUNDS = 10;

/**
 * 로그인된 사용자의 비밀번호 변경 API
 * PUT /api/users/change-password
 * @param request - 요청 객체 (현재 비밀번호, 새 비밀번호 포함)
 * @returns 성공 여부
 *
 * @description
 * Frontend Design Guideline 적용:
 * - Single Responsibility: 비밀번호 변경만 담당
 * - Predictability: 일관된 인증 및 응답 구조
 * - Error Handling: 안전한 에러 처리
 */
export async function PUT(request: NextRequest) {
  // 인증 확인
  const authHeader = request.headers.get(AUTH_HEADER);
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
    // 요청 본문 파싱
    const body = await request.json();
    const { currentPassword, newPassword } = body;

    console.log(`비밀번호 변경 시도: 사용자 ID ${userId}`);

    // 입력값 검증
    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "현재 비밀번호와 새 비밀번호를 모두 입력해주세요." },
        { status: 400 }
      );
    }

    // 새 비밀번호 길이 검증
    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: "새 비밀번호는 8자 이상이어야 합니다." },
        { status: 400 }
      );
    }

    // 현재 비밀번호와 새 비밀번호가 같은지 확인
    if (currentPassword === newPassword) {
      return NextResponse.json(
        { error: "현재 비밀번호와 다른 비밀번호를 입력해주세요." },
        { status: 400 }
      );
    }

    connection = await pool.getConnection();

    // 사용자 정보 조회
    const [userRows] = await connection.query(
      "SELECT id, password FROM users WHERE id = ?",
      [userId]
    );

    if ((userRows as any[]).length === 0) {
      connection.release();
      console.log(`사용자를 찾을 수 없음: ID ${userId}`);
      return NextResponse.json(
        { error: "사용자를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const user = (userRows as any[])[0];
    console.log(`사용자 찾음: ID ${user.id}`);

    // 현재 비밀번호 확인
    const isCurrentPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password
    );

    if (!isCurrentPasswordValid) {
      connection.release();
      console.log(`현재 비밀번호 불일치: 사용자 ID ${userId}`);
      return NextResponse.json(
        { error: "현재 비밀번호가 일치하지 않습니다." },
        { status: 400 }
      );
    }

    console.log(`현재 비밀번호 검증 성공: 사용자 ID ${userId}`);

    // 새 비밀번호 해싱
    const hashedNewPassword = await bcrypt.hash(
      newPassword,
      BCRYPT_SALT_ROUNDS
    );

    // 비밀번호 업데이트
    const [updateResult] = await connection.query(
      "UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?",
      [hashedNewPassword, userId]
    );

    if ((updateResult as any).affectedRows === 0) {
      connection.release();
      return NextResponse.json(
        { error: "비밀번호 변경에 실패했습니다." },
        { status: 500 }
      );
    }

    connection.release();

    console.log(`비밀번호 변경 성공: 사용자 ID ${userId}`);

    return NextResponse.json({
      success: true,
      message: "비밀번호가 성공적으로 변경되었습니다.",
    });
  } catch (error) {
    console.error("비밀번호 변경 오류:", error);
    if (connection) connection.release();
    return NextResponse.json(
      { error: "서버 내부 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
