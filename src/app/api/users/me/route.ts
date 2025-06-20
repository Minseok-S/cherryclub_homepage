import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../utils/db";
import { verifyJwt } from "../../utils/jwt";
import { AuthorityService } from "../../utils/authority-service";

// 인증 헤더 상수
const AUTH_HEADER = "authorization";

/**
 * 현재 로그인된 사용자 정보 조회 API
 * GET /api/users/me
 * Frontend Design Guideline의 Standardizing Return Types 원칙에 따라 일관된 응답 구조 제공
 * @param request - NextRequest 객체
 * @returns 현재 사용자 정보 (새로운 권한 구조 포함)
 */
export async function GET(request: NextRequest) {
  // 인증 확인
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = authHeader?.split(" ")[1];

  if (!token) {
    return NextResponse.json(
      { error: "인증 토큰이 필요합니다." },
      { status: 401 }
    );
  }

  const payload = verifyJwt(token);
  if (!payload) {
    return NextResponse.json(
      { error: "인증토큰이 만료되었습니다." },
      { status: 401 }
    );
  }

  const userId = payload.id;

  let connection;
  try {
    connection = await pool.getConnection();

    // 현재 사용자 정보 조회 (이메일 포함)
    // 새로운 권한 체계에서는 authority 컬럼이 제거되었으므로 쿼리에서 제외
    const [userRows] = await connection.query(
      `SELECT 
        u.id, u.name, u.phone, u.email, u.birthday, u.gender,
        u.major, u.student_id, u.grade, u.semester, u.enrollment_status,
        u.vision_camp_batch, u.ministry_status, u.is_cherry_club_member,
        u.isCampusLeader, u.created_at, u.updated_at, u.fcm_token,
        u.region_group_id,
        univ.name AS university,
        rg.region, rg.group_number
      FROM users u
      LEFT JOIN Universities univ ON u.universe_id = univ.id
      LEFT JOIN region_groups rg ON u.region_group_id = rg.id
      WHERE u.id = ?`,
      [userId]
    );

    if ((userRows as any[]).length === 0) {
      connection.release();
      return NextResponse.json(
        { error: "사용자를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const user = (userRows as any[])[0];

    // 새로운 권한 구조 조회
    // Frontend Design Guideline의 Coupling 원칙에 따라 권한 로직을 분리된 서비스에서 처리
    const userAuthorities = await AuthorityService.getUserAuthorities(
      connection,
      userId
    );

    connection.release();

    // 응답 데이터 구성
    // Cohesion 원칙에 따라 관련 데이터를 그룹화
    const responseData = {
      success: true,
      user: {
        // 기본 사용자 정보
        ...user,

        // 새로운 권한 구조 정보
        authorities: userAuthorities
          ? AuthorityService.formatForApi(userAuthorities)
          : null,

        // 레거시 호환성을 위한 기존 authority 필드 유지
        // Migration 완료 후 제거 예정
        // 새로운 권한 체계에서는 첫 번째 권한을 문자열로 반환
        authority: userAuthorities?.authorities?.[0]?.display_name || "리더",

        // 권한 표시 문자열 (UI에서 바로 사용 가능)
        authorityDisplayString: userAuthorities
          ? userAuthorities.authorityDisplayNames
          : "리더",

        // 권한 요약 정보
        authoritySummary: userAuthorities
          ? {
              isMasterAuthority:
                AuthorityService.isMasterAuthority(userAuthorities),
              canManageUsers: AuthorityService.canManageUsers(userAuthorities),
              canManageTraining:
                AuthorityService.canManageTraining(userAuthorities),
              highestLevel: userAuthorities.highestAuthorityLevel,
            }
          : {
              isMasterAuthority: false,
              canManageUsers: false,
              canManageTraining: false,
              highestLevel: 999,
            },
      },
    };

    return NextResponse.json(responseData);
  } catch (error) {
    console.error("현재 사용자 정보 조회 오류:", error);
    if (connection) connection.release();
    return NextResponse.json(
      { error: "사용자 정보 조회에 실패했습니다." },
      { status: 500 }
    );
  }
}

/**
 * 사용자 권한 업데이트 API
 * PUT /api/users/me
 * 겸직을 위한 권한 추가/제거 기능
 */
export async function PUT(request: NextRequest) {
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = authHeader?.split(" ")[1];

  if (!token) {
    return NextResponse.json(
      { error: "인증 토큰이 필요합니다." },
      { status: 401 }
    );
  }

  const payload = verifyJwt(token);
  if (!payload) {
    return NextResponse.json(
      { error: "인증토큰이 만료되었습니다." },
      { status: 401 }
    );
  }

  const userId = payload.id;

  let connection;
  try {
    const body = await request.json();
    const { action, authorityId } = body;

    if (!action || !authorityId) {
      return NextResponse.json(
        { error: "action과 authorityId가 필요합니다." },
        { status: 400 }
      );
    }

    connection = await pool.getConnection();

    // 현재 사용자 권한 확인
    const currentAuthorities = await AuthorityService.getUserAuthorities(
      connection,
      userId
    );
    if (!currentAuthorities) {
      connection.release();
      return NextResponse.json(
        { error: "사용자 권한 정보를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // 자신의 권한만 수정 가능하도록 제한 (관리자 권한 필요 시 별도 API 구현)
    let success = false;

    if (action === "add") {
      success = await AuthorityService.addUserAuthority(
        connection,
        userId,
        authorityId,
        userId
      );
    } else if (action === "remove") {
      success = await AuthorityService.removeUserAuthority(
        connection,
        userId,
        authorityId
      );
    }

    if (!success) {
      connection.release();
      return NextResponse.json(
        { error: "권한 업데이트에 실패했습니다." },
        { status: 500 }
      );
    }

    // 업데이트된 권한 정보 재조회
    const updatedAuthorities = await AuthorityService.getUserAuthorities(
      connection,
      userId
    );

    connection.release();

    return NextResponse.json({
      success: true,
      message: `권한이 성공적으로 ${
        action === "add" ? "추가" : "제거"
      }되었습니다.`,
      authorities: updatedAuthorities
        ? AuthorityService.formatForApi(updatedAuthorities)
        : null,
    });
  } catch (error) {
    console.error("사용자 권한 업데이트 오류:", error);
    if (connection) connection.release();
    return NextResponse.json(
      { error: "권한 업데이트에 실패했습니다." },
      { status: 500 }
    );
  }
}
