import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../utils/db";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

/**
 * 사용자 비밀번호 변경 API
 * POST /api/users/change-password
 * @param {NextRequest} req
 * @returns {Promise<NextResponse>}
 */
export async function POST(req: NextRequest) {
  let connection;
  try {
    console.log("🔐 비밀번호 변경 API 호출됨");
    console.log("🔐 요청 URL:", req.url);
    console.log("🔐 요청 메소드:", req.method);

    // Authorization 헤더에서 토큰 추출
    const authHeader = req.headers.get("authorization");
    console.log("🔐 Authorization 헤더:", authHeader ? "존재함" : "없음");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.log("🔐 인증 헤더 없음 또는 잘못된 형식");
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    const token = authHeader.split(" ")[1];
    console.log("🔐 토큰 추출됨:", token ? "존재함" : "없음");
    let userId: number;

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
      console.log("🔐 JWT 페이로드 전체:", decoded);
      console.log("🔐 사용 가능한 필드들:", Object.keys(decoded));

      // 다양한 필드명 시도
      userId = decoded.userId || decoded.id || decoded.user_id || decoded.sub;
      console.log("🔐 토큰 검증 성공, 사용자 ID:", userId);
      console.log("🔐 사용자 ID 타입:", typeof userId);

      if (!userId) {
        console.log("🔐 JWT에서 사용자 ID를 찾을 수 없음");
        return NextResponse.json(
          { error: "토큰에서 사용자 정보를 찾을 수 없습니다." },
          { status: 401 }
        );
      }
    } catch (error) {
      console.log("🔐 토큰 검증 실패:", error);
      return NextResponse.json(
        { error: "유효하지 않은 토큰입니다." },
        { status: 401 }
      );
    }

    const { currentPassword, newPassword } = await req.json();

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "현재 비밀번호와 새 비밀번호가 필요합니다." },
        { status: 400 }
      );
    }

    // 새 비밀번호 유효성 검사
    if (newPassword.length < 8 || newPassword.length > 20) {
      return NextResponse.json(
        { error: "비밀번호는 8-20자 사이여야 합니다." },
        { status: 400 }
      );
    }

    if (
      !/^(?=.*[a-zA-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/.test(
        newPassword
      )
    ) {
      return NextResponse.json(
        { error: "비밀번호는 영문, 숫자, 특수문자를 포함해야 합니다." },
        { status: 400 }
      );
    }

    connection = await pool.getConnection();

    // 현재 사용자 정보 조회
    const [userRows] = await connection.query(
      "SELECT password FROM users WHERE id = ?",
      [userId]
    );

    const user = (userRows as any[])[0];
    if (!user) {
      connection.release();
      return NextResponse.json(
        { error: "사용자를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // 현재 비밀번호 확인
    const isCurrentPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password
    );
    if (!isCurrentPasswordValid) {
      connection.release();
      return NextResponse.json(
        { error: "현재 비밀번호가 올바르지 않습니다." },
        { status: 400 }
      );
    }

    // 새 비밀번호가 현재 비밀번호와 같은지 확인
    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      connection.release();
      return NextResponse.json(
        { error: "새 비밀번호는 현재 비밀번호와 달라야 합니다." },
        { status: 400 }
      );
    }

    // 새 비밀번호 해시화
    const saltRounds = 12;
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

    // 비밀번호 업데이트
    await connection.query(
      "UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [hashedNewPassword, userId]
    );

    connection.release();

    return NextResponse.json({
      success: true,
      message: "비밀번호가 성공적으로 변경되었습니다.",
    });
  } catch (error: any) {
    if (connection) connection.release();
    console.error("비밀번호 변경 오류:", error);
    return NextResponse.json(
      { error: error.message || "비밀번호 변경 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
