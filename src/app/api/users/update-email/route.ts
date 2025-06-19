import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../utils/db";
import jwt from "jsonwebtoken";

/**
 * 사용자 이메일 업데이트 API
 * POST /api/users/update-email
 * @param {NextRequest} req
 * @returns {Promise<NextResponse>}
 */
export async function POST(req: NextRequest) {
  console.log("📧 [이메일 업데이트 API] 시작됨");
  let connection;
  try {
    // Authorization 헤더에서 토큰 추출
    const authHeader = req.headers.get("authorization");
    console.log(
      "📧 [인증 헤더] Authorization:",
      authHeader
        ? `Bearer ${authHeader.split(" ")[1]?.substring(0, 20)}...`
        : "없음"
    );

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.log("📧 [에러] Authorization 헤더 없음 또는 형식 오류");
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    const token = authHeader.split(" ")[1];
    console.log(
      "📧 [토큰] 추출된 토큰:",
      token ? `${token.substring(0, 20)}...` : "없음"
    );
    let userId: number;

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
      userId = decoded.id; // JWT 토큰에서 'id' 필드 사용 (userId가 아님)
      console.log("📧 [토큰 검증] 성공, 사용자 ID:", userId);
      console.log("📧 [토큰 페이로드] 전체:", decoded);
    } catch (error) {
      console.log("📧 [토큰 검증] 실패:", error);
      return NextResponse.json(
        { error: "유효하지 않은 토큰입니다." },
        { status: 401 }
      );
    }

    const { email } = await req.json();
    console.log("📧 [요청 데이터] 새 이메일:", email);

    if (!email) {
      console.log("📧 [에러] 이메일 누락");
      return NextResponse.json(
        { error: "이메일이 필요합니다." },
        { status: 400 }
      );
    }

    // 이메일 유효성 검사
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      console.log("📧 [에러] 이메일 형식 오류:", email);
      return NextResponse.json(
        { error: "올바른 이메일 형식이 아닙니다." },
        { status: 400 }
      );
    }

    connection = await pool.getConnection();
    console.log("📧 [DB 연결] 성공");

    // 현재 사용자 존재 확인
    const [userRows] = await connection.query(
      "SELECT id, email FROM users WHERE id = ?",
      [userId]
    );
    console.log("📧 [DB 조회] 사용자 조회 결과:", userRows);

    const user = (userRows as any[])[0];
    if (!user) {
      console.log("📧 [에러] 사용자를 찾을 수 없음, ID:", userId);
      connection.release();
      return NextResponse.json(
        { error: "사용자를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    console.log(
      "📧 [사용자 정보] 현재 이메일:",
      user.email,
      "-> 새 이메일:",
      email
    );

    // 현재 이메일과 같은지 확인
    if (user.email === email) {
      console.log("📧 [에러] 현재 이메일과 동일함");
      connection.release();
      return NextResponse.json(
        { error: "현재 이메일과 동일합니다." },
        { status: 400 }
      );
    }

    // 다른 사용자가 같은 이메일을 사용하는지 확인
    const [existingEmailRows] = await connection.query(
      "SELECT id FROM users WHERE email = ? AND id != ?",
      [email, userId]
    );
    console.log("📧 [DB 조회] 이메일 중복 확인 결과:", existingEmailRows);

    if ((existingEmailRows as any[]).length > 0) {
      console.log("📧 [에러] 이미 사용 중인 이메일");
      connection.release();
      return NextResponse.json(
        { error: "이미 사용 중인 이메일입니다." },
        { status: 400 }
      );
    }

    // 이메일 업데이트
    console.log("📧 [DB 업데이트] 시작...");
    await connection.query(
      "UPDATE users SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [email, userId]
    );
    console.log("📧 [DB 업데이트] 완료");

    connection.release();
    console.log("📧 [API 완료] 이메일 업데이트 성공");

    return NextResponse.json({
      success: true,
      message: "이메일이 성공적으로 업데이트되었습니다.",
      email: email,
    });
  } catch (error: any) {
    console.log("📧 [API 에러] 이메일 업데이트 실패:", error);
    if (connection) connection.release();
    console.error("이메일 업데이트 오류:", error);
    return NextResponse.json(
      { error: error.message || "이메일 업데이트 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
