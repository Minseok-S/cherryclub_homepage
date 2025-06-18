import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../utils/db";
import { verifyJwt } from "../../../../utils/jwt";

// 인증 헤더 상수
const AUTH_HEADER = "authorization";

/**
 * 특정 조의 멤버 목록 조회 API
 * GET /api/branches/[region]/[groupNumber]/members
 * @param request - NextRequest 객체
 * @param context - 라우트 매개변수
 * @returns 특정 조의 멤버 목록
 *
 * @description
 * Frontend Design Guideline 적용:
 * - Single Responsibility: 특정 조의 멤버 정보만 처리
 * - Predictability: 일관된 응답 구조
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ region: string; groupNumber: string }> }
) {
  // 인증 확인
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = authHeader?.split(" ")[1];
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const { region, groupNumber } = await context.params;

  // 파라미터 디코딩
  const decodedRegion = decodeURIComponent(region);
  const decodedGroupNumber = decodeURIComponent(groupNumber);

  let connection;
  try {
    connection = await pool.getConnection();

    // 조 존재 여부 확인
    const [groupRows] = await connection.query(
      "SELECT id FROM region_groups WHERE region = ? AND group_number = ?",
      [decodedRegion, decodedGroupNumber]
    );

    if ((groupRows as any[]).length === 0) {
      connection.release();
      return NextResponse.json(
        { error: "해당 조를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const groupId = (groupRows as any[])[0].id;

    // 조 멤버 목록 조회
    const [membersRows] = await connection.query(
      `SELECT 
        u.id,
        u.name,
        u.phone,
        u.grade,
        u.semester,
        u.major,
        u.enrollment_status,
        u.ministry_status,
        u.is_cherry_club_member,
        u.isGroupLeader,
        u.isBranchLeader,
        univ.name as university_name,
        rg.region,
        rg.group_number
      FROM users u
      JOIN region_groups rg ON u.region_group_id = rg.id
      LEFT JOIN Universities univ ON u.universe_id = univ.id
      WHERE rg.id = ?
      ORDER BY 
        u.isGroupLeader DESC,
        u.isBranchLeader DESC,
        u.name ASC`,
      [groupId]
    );

    connection.release();

    // Frontend Design Guideline: Predictability - 일관된 응답 구조
    const members = (membersRows as any[]).map((member) => ({
      id: member.id,
      name: member.name,
      phone: member.phone,
      grade: member.grade,
      semester: member.semester,
      major: member.major,
      enrollment_status: member.enrollment_status,
      ministry_status: member.ministry_status,
      university_name: member.university_name,
      is_group_leader: !!member.isGroupLeader,
      is_branch_leader: !!member.isBranchLeader,
      is_cherry_club_member: member.is_cherry_club_member,
    }));

    return NextResponse.json({
      success: true,
      region: decodedRegion,
      group_number: decodedGroupNumber,
      member_count: members.length,
      members,
    });
  } catch (error) {
    console.error("조 멤버 목록 조회 오류:", error);
    if (connection) connection.release();
    return NextResponse.json(
      { error: "조 멤버 목록 조회에 실패했습니다." },
      { status: 500 }
    );
  }
}
