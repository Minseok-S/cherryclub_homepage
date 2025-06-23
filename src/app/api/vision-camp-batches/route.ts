import { NextRequest, NextResponse } from "next/server";
import { pool } from "../utils/db";

/**
 * 비전캠프 기수 목록 조회 API
 * GET /api/vision-camp-batches
 */
export async function GET(req: NextRequest) {
  try {
    const connection = await pool.getConnection();

    // 비전캠프 기수 목록 조회 (1기부터 현재까지)
    const [batches] = await connection.query(`
      SELECT 
        batch_number,
        CONCAT(batch_number, '기') as display_name,
        is_active,
        created_at
      FROM vision_camp_batches 
      WHERE is_active = 1
      ORDER BY batch_number DESC
    `);

    connection.release();

    // DB에 기수 정보가 없으면 기본 기수 생성 (1기~30기)
    if (!Array.isArray(batches) || batches.length === 0) {
      const defaultBatches = [];
      for (let i = 30; i >= 1; i--) {
        defaultBatches.push({
          batch_number: i,
          display_name: `${i}기`,
          is_active: 1,
          created_at: new Date(),
        });
      }

      return NextResponse.json({
        success: true,
        data: [
          { batch_number: 0, display_name: "미수료", is_active: 1 },
          ...defaultBatches,
        ],
      });
    }

    // '미수료' 옵션을 맨 앞에 추가
    const result = [
      { batch_number: 0, display_name: "미수료", is_active: 1 },
      ...(batches as any[]),
    ];

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("비전캠프 기수 목록 조회 실패:", error);

    // 에러 발생 시 기본 데이터 반환
    const fallbackBatches = [];
    for (let i = 30; i >= 1; i--) {
      fallbackBatches.push({
        batch_number: i,
        display_name: `${i}기`,
        is_active: 1,
      });
    }

    return NextResponse.json({
      success: true,
      data: [
        { batch_number: 0, display_name: "미수료", is_active: 1 },
        ...fallbackBatches,
      ],
    });
  }
}
