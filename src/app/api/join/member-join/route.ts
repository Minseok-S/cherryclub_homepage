import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import bcrypt from "bcrypt";
import { pool } from "../../utils/db";

export async function POST(request: Request) {
  try {
    const connection = await pool.getConnection();
    const data = await request.json();

    const requiredFields = [
      "name",
      "gender",
      "phone",
      "birthday",
      "email", // 이메일 필수 필드 추가
      "universe_id",
      "major",
      "student_id",
      "grade",
      "semester",
      "enrollment_status",
      "vision_camp_batch",
      "ministry_status",
      "is_cherry_club_member",
      "region_group_id",
      "password",
    ];
    if (requiredFields.some((field) => !data[field] && data[field] !== 0)) {
      return NextResponse.json(
        { error: "필수 항목이 누락되었습니다" },
        { status: 400 }
      );
    }

    // 전화번호 정규화 (하이픈 제거)
    const normalizePhone = (p: string) => p.replace(/[^0-9]/g, "");
    const cleanPhone = normalizePhone(data.phone);

    // 전화번호 중복 체크 - DB에 하이픈 포함/제외 모든 형식으로 저장될 수 있으므로 양쪽 모두 확인
    const [existingUser] = (await connection.query(
      "SELECT id FROM Applications WHERE REPLACE(phone, '-', '') = ? OR phone = ?",
      [cleanPhone, cleanPhone]
    )) as [mysql.RowDataPacket[], mysql.FieldPacket[]];

    if ((existingUser as mysql.RowDataPacket[])[0]) {
      return NextResponse.json(
        {
          error: "이미 등록된 전화번호입니다",
          code: "ER_DUP_ENTRY",
          message: `Duplicate entry '${data.phone}' for key 'applications.contact'`,
        },
        { status: 400 }
      );
    }

    const password = await bcrypt.hash(data.password, 10); // 사용자가 입력한 비밀번호 해싱

    // 쿼리 파라미터 배열 생성
    const queryParams = [
      data.name,
      data.gender,
      data.phone,
      data.birthday,
      data.email, // 인증된 이메일 추가
      data.universe_id,
      data.major,
      data.student_id,
      data.grade,
      data.semester,
      data.enrollment_status,
      data.vision_camp_batch,
      data.ministry_status,
      data.is_cherry_club_member,
      data.region_group_id,
      password, // 사용자가 입력한 비밀번호 해싱값
    ];

    const [result] = await connection.query(
      `INSERT INTO users SET 
        name = ?, 
        gender = ?, 
        phone = ?,
        birthday = ?, 
        email = ?, 
        universe_id = ?, 
        major = ?, 
        student_id = ?,
        grade = ?,      
        semester = ?, 
        enrollment_status = ?,
        vision_camp_batch = ?,
        ministry_status = ?,
        is_cherry_club_member = ?,
        region_group_id = ?, 
        password = ?,
        created_at = NOW()`,
      queryParams
    );

    connection.release();
    return NextResponse.json({ success: true, id: result });
  } catch (error: unknown) {
    console.error("Database error:", error);

    // MySQL 에러 타입 가드
    if (error && typeof error === "object" && "code" in error) {
      const mysqlError = error as { code: string; message: string };

      // MySQL 중복 키 에러 처리
      if (mysqlError.code === "ER_DUP_ENTRY") {
        return NextResponse.json(
          {
            error: "이미 등록된 전화번호입니다",
            code: mysqlError.code,
            message: mysqlError.message,
          },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      { error: "서버 내부 오류가 발생했습니다" },
      { status: 500 }
    );
  }
}
