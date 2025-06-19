import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { pool } from "../../utils/db";

export async function POST(request: Request) {
  try {
    const connection = await pool.getConnection();
    const data = await request.json();

    const requiredFields = [
      "name",
      "phone",
      "birthday",
      "region",
      "university",
      "major",
      "student_id",
      "grade",
      "semester",
    ];
    if (requiredFields.some((field) => !data[field])) {
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

    // 쿼리 파라미터 배열 생성
    const queryParams = [
      data.name,
      data.gender,
      data.phone,
      data.birthday,
      data.region,
      data.university,
      data.major,
      data.student_id,
      data.grade,
      data.semester,
      data.vision_camp_batch || "미수료",
      data.status || "PENDING",
      data.message,
    ];

    const [result] = await connection.query(
      `INSERT INTO Applications SET 
        name = ?, 
        gender = ?, 
        phone = ?,
        birthday = ?, 
        region = ?,   
        university = ?, 
        major = ?, 
        student_id = ?,
        grade = ?,      
        semester = ?, 
        vision_camp_batch = ?,
        status = ?,  
        message = ?,
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
