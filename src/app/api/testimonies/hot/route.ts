import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../utils/db";
import { verifyJwt } from "../../utils/jwt";

// 인증 헤더 상수
const AUTH_HEADER = "authorization";

/**
 * HOT 게시글 목록 조회 API
 * GET /api/testimonies/hot?page=1&page_size=10
 * @param request - NextRequest 객체
 * @returns HOT 게시글 목록 (좋아요 10개 이상, 좋아요 수 내림차순)
 *
 * @description
 * Frontend Design Guideline 적용:
 * - Cohesion: HOT 게시글 관련 로직을 별도로 관리
 * - Predictability: 일반 간증 목록과 동일한 구조
 */
export async function GET(request: NextRequest) {
  try {
    // 페이지네이션 파라미터
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const pageSize = parseInt(searchParams.get("page_size") || "10");

    // 페이지 및 사이즈 유효성 검증
    if (isNaN(page) || isNaN(pageSize) || page < 1 || pageSize < 1) {
      return NextResponse.json(
        { error: "유효하지 않은 페이지 파라미터입니다." },
        { status: 400 }
      );
    }

    // 인증 확인 (선택적)
    const authHeader = request.headers.get(AUTH_HEADER);
    const token = authHeader?.split(" ")[1];
    const userId = token ? verifyJwt(token)?.id : null;

    const connection = await pool.getConnection();

    // 페이징 처리를 위한 offset 계산
    const offset = (page - 1) * pageSize;

    // HOT 게시글 목록 조회 (좋아요 10개 이상, 좋아요 수 내림차순)
    const [testimonyRows] = await connection.query(
      `SELECT 
        t.id, t.category, LEFT(t.content, 200) AS content, 
        t.created_at, t.updated_at, 
        t.view_count, t.like_count, 
        (SELECT COUNT(*) FROM testimony_comments WHERE testimony_id = t.id) AS comment_count,
        u.id AS author_id, u.name AS author_name,
        univ.name AS author_school,
        EXISTS(SELECT 1 FROM testimony_likes WHERE testimony_id = t.id AND user_id = ?) AS is_liked,
        1 AS is_hot
      FROM testimonies t
      JOIN users u ON t.author_id = u.id
      LEFT JOIN Universities univ ON u.universe_id = univ.id
      WHERE t.like_count >= 10
      ORDER BY t.created_at DESC
      LIMIT ? OFFSET ?`,
      [userId || 0, pageSize, offset]
    );

    // 각 간증에 대한 이미지 조회
    const testimonies = [];
    for (const testimony of testimonyRows as any[]) {
      const [imageRows] = await connection.query(
        "SELECT image_url FROM testimony_images WHERE testimony_id = ?",
        [testimony.id]
      );

      testimonies.push({
        ...testimony,
        image_urls: (imageRows as any[]).map((img) => img.image_url),
        is_liked: !!testimony.is_liked,
      });
    }

    connection.release();

    return NextResponse.json({
      success: true,
      testimonies,
      pagination: {
        page,
        page_size: pageSize,
        has_more: testimonies.length === pageSize,
      },
    });
  } catch (error) {
    console.error("HOT 게시글 목록 조회 오류:", error);
    return NextResponse.json(
      { error: "HOT 게시글 목록 조회에 실패했습니다." },
      { status: 500 }
    );
  }
}
