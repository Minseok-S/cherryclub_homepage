import { NextResponse } from "next/server";
import { pool } from "../utils/db";
import mysql from "mysql2/promise";

/**
 * 활성화된 학번 목록 조회
 * Frontend Design Guideline: Predictability - 일관된 API 응답 형태
 */
export async function GET() {
  try {
    const connection = await pool.getConnection();

    // 활성화된 학번들을 조회 (is_active = true)
    const [rows] = (await connection.query(`
      SELECT 
        year_code,
        display_name,
        full_year,
        is_active,
        created_at
      FROM academic_years 
      WHERE is_active = true 
      ORDER BY year_code DESC
    `)) as [mysql.RowDataPacket[], mysql.FieldPacket[]];

    connection.release();

    return NextResponse.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("학번 조회 오류:", error);
    return NextResponse.json(
      {
        success: false,
        error: "학번 목록을 불러올 수 없습니다",
      },
      { status: 500 }
    );
  }
}

/**
 * 새로운 학번 추가 (관리자 전용)
 * Frontend Design Guideline: Single Responsibility - 학번 생성만 담당
 */
export async function POST(request: Request) {
  try {
    const { year_code, display_name, full_year } = await request.json();

    // 입력 검증
    if (!year_code || !display_name || !full_year) {
      return NextResponse.json(
        {
          success: false,
          error: "필수 항목이 누락되었습니다",
        },
        { status: 400 }
      );
    }

    const connection = await pool.getConnection();

    // 중복 확인
    const [existing] = (await connection.query(
      `
      SELECT id FROM academic_years WHERE year_code = ?
    `,
      [year_code]
    )) as [mysql.RowDataPacket[], mysql.FieldPacket[]];

    if (existing.length > 0) {
      connection.release();
      return NextResponse.json(
        {
          success: false,
          error: "이미 존재하는 학번입니다",
        },
        { status: 400 }
      );
    }

    // 새로운 학번 추가
    await connection.query(
      `
      INSERT INTO academic_years (year_code, display_name, full_year, is_active, created_at)
      VALUES (?, ?, ?, true, NOW())
    `,
      [year_code, display_name, full_year]
    );

    connection.release();

    return NextResponse.json({
      success: true,
      message: "새로운 학번이 추가되었습니다",
    });
  } catch (error) {
    console.error("학번 추가 오류:", error);
    return NextResponse.json(
      {
        success: false,
        error: "학번 추가 중 오류가 발생했습니다",
      },
      { status: 500 }
    );
  }
}
