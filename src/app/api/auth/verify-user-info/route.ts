import { NextResponse } from "next/server";
import { pool } from "../../utils/db";
import mysql from "mysql2/promise";

export async function POST(request: Request) {
  try {
    const connection = await pool.getConnection();
    const { phone, email } = await request.json();

    // 필수 필드 검증
    if (!phone || !email) {
      return NextResponse.json(
        { error: "전화번호와 이메일을 모두 입력해 주세요." },
        { status: 400 }
      );
    }

    // Frontend Design Guideline: Predictability - 전화번호 정규화로 일관성 있는 처리 (로그인 API와 동일)
    const normalizePhone = (p: string) => p.replace(/[^0-9]/g, "");
    const cleanPhone = normalizePhone(phone);

    // Frontend Design Guideline: Single Responsibility - 사용자 정보 매칭 검증만 담당
    // DB에 하이픈 포함/제외 모든 형식으로 저장될 수 있으므로 양쪽 모두 확인
    const [users] = (await connection.query(
      "SELECT id, name FROM users WHERE (REPLACE(phone, '-', '') = ? OR phone = ?) AND email = ?",
      [cleanPhone, cleanPhone, email]
    )) as [mysql.RowDataPacket[], mysql.FieldPacket[]];

    connection.release();

    if (users.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "입력하신 전화번호와 이메일이 일치하는 사용자를 찾을 수 없습니다.",
        },
        { status: 404 }
      );
    }

    // 보안상 사용자 존재 여부만 확인, 민감한 정보는 반환하지 않음
    return NextResponse.json({
      success: true,
      message: "사용자 정보가 확인되었습니다.",
      userName: users[0].name, // 사용자 확신을 위한 이름만 반환
    });
  } catch (error: unknown) {
    console.error("User verification error:", error);
    return NextResponse.json(
      { error: "서버 내부 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
