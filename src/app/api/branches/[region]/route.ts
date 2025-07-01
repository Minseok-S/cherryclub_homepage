import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../utils/db";
import { verifyJwt } from "../../utils/jwt";
import { AuthorityService } from "../../utils/authority-service";

// 인증 헤더 상수
const AUTH_HEADER = "authorization";

/**
 * 특정 지역의 조 정보 조회 API
 * GET /api/branches/[region]
 * @param request - NextRequest 객체
 * @param context - 라우트 매개변수
 * @returns 특정 지역의 조 목록 (조장, 멤버 수)
 *
 * @description
 * Frontend Design Guideline 적용:
 * - Single Responsibility: 특정 지역의 조 정보만 처리하며 새로운 권한 체제 사용
 * - Cohesion: 조 관련 정보를 함께 관리하고 권한 로직을 AuthorityService로 통합
 * - Predictability: 일관된 응답 구조 제공
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ region: string }> }
) {
  // 인증 확인
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = authHeader?.split(" ")[1];
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const { region } = await context.params;

  // 지역명 디코딩 (URL 인코딩된 경우)
  const decodedRegion = decodeURIComponent(region);

  let connection;
  try {
    connection = await pool.getConnection();

    // Frontend Design Guideline: Single Responsibility - 새로운 권한 체제로 조장 조회
    // 특정 지역의 조 목록 조회 (새로운 권한 구조 사용)
    const [groupsRows] = await connection.query(
      `SELECT 
        rg.id,
        rg.region,
        rg.group_number,
        COUNT(u.id) as member_count,
        -- 새로운 권한 체제: 조장 권한을 가진 사용자 조회
        (SELECT u2.name 
         FROM users u2 
         INNER JOIN user_authorities ua2 ON u2.id = ua2.user_id
         INNER JOIN authorities a2 ON ua2.authority_id = a2.id
         WHERE u2.region_group_id = rg.id
         AND a2.name = 'GROUP_LEADER' 
         AND ua2.is_active = TRUE
         LIMIT 1) as group_leader_name,
        (SELECT u2.id 
         FROM users u2 
         INNER JOIN user_authorities ua2 ON u2.id = ua2.user_id
         INNER JOIN authorities a2 ON ua2.authority_id = a2.id
         WHERE u2.region_group_id = rg.id
         AND a2.name = 'GROUP_LEADER' 
         AND ua2.is_active = TRUE
         LIMIT 1) as group_leader_id,
        (SELECT univ.name 
         FROM users u2 
         INNER JOIN user_authorities ua2 ON u2.id = ua2.user_id
         INNER JOIN authorities a2 ON ua2.authority_id = a2.id
         LEFT JOIN Universities univ ON u2.universe_id = univ.id
         WHERE u2.region_group_id = rg.id
         AND a2.name = 'GROUP_LEADER' 
         AND ua2.is_active = TRUE
         LIMIT 1) as group_leader_school
      FROM region_groups rg
      LEFT JOIN users u ON u.region_group_id = rg.id
      WHERE rg.region = ?
      GROUP BY rg.id, rg.region, rg.group_number
      ORDER BY rg.group_number`,
      [decodedRegion]
    );

    if ((groupsRows as any[]).length === 0) {
      connection.release();
      return NextResponse.json(
        { error: "해당 지역을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    connection.release();

    // Frontend Design Guideline: Predictability - 일관된 응답 구조
    const groups = (groupsRows as any[]).map((group) => ({
      id: group.id,
      region: group.region,
      group_number: group.group_number,
      member_count: group.member_count,
      group_leader: group.group_leader_name
        ? {
            id: group.group_leader_id,
            name: group.group_leader_name,
            school: group.group_leader_school,
          }
        : null,
    }));

    return NextResponse.json({
      success: true,
      region: decodedRegion,
      groups,
    });
  } catch (error) {
    console.error("지역 조 정보 조회 오류:", error);
    if (connection) connection.release();
    return NextResponse.json(
      { error: "지역 조 정보 조회에 실패했습니다." },
      { status: 500 }
    );
  }
}
