import { NextRequest, NextResponse } from "next/server";
import { pool } from "../utils/db";
import { verifyJwt } from "../utils/jwt";
import { AuthorityService } from "../utils/authority-service";

const AUTH_HEADER = "authorization";

/**
 * 권한 목록 조회 API
 * GET /api/authorities
 * Frontend Design Guideline의 Standardizing Return Types 원칙에 따라 일관된 응답 구조 제공
 */
export async function GET(request: NextRequest) {
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

  let connection;
  try {
    connection = await pool.getConnection();

    // 권한 목록 조회
    const authorities = await AuthorityService.getAllAuthorities(connection);

    // 권한 카테고리 목록 조회
    const categories = await AuthorityService.getAuthorityCategories(
      connection
    );

    connection.release();

    // Frontend Design Guideline: Predictability - 일관된 camelCase 응답 형식 제공
    return NextResponse.json({
      success: true,
      data: {
        authorities: authorities.map((auth) => ({
          id: auth.id,
          categoryId: auth.category_id, // snake_case -> camelCase 변환
          name: auth.name,
          displayName: auth.display_name, // snake_case -> camelCase 변환
          level: auth.level,
          isActive: auth.is_active, // snake_case -> camelCase 변환
          createdAt: auth.created_at.toISOString(), // snake_case -> camelCase 변환
        })),
        categories: categories.map((category) => ({
          id: category.id,
          name: category.name,
          description: category.description,
          createdAt: category.created_at.toISOString(), // snake_case -> camelCase 변환
        })),
      },
    });
  } catch (error) {
    console.error("권한 목록 조회 오류:", error);
    if (connection) connection.release();
    return NextResponse.json(
      { error: "권한 목록 조회에 실패했습니다." },
      { status: 500 }
    );
  }
}

/**
 * 사용자 권한 관리 API
 * POST /api/authorities
 * 관리자가 다른 사용자의 권한을 관리하는 기능
 */
export async function POST(request: NextRequest) {
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

  const currentUserId = payload.id;

  let connection;
  try {
    const body = await request.json();
    const { action, targetUserId, authorityId } = body;

    if (!action || !targetUserId || !authorityId) {
      return NextResponse.json(
        { error: "action, targetUserId, authorityId가 필요합니다." },
        { status: 400 }
      );
    }

    connection = await pool.getConnection();

    // 현재 사용자 권한 확인 (관리자 권한 필요)
    const currentUserAuthorities = await AuthorityService.getUserAuthorities(
      connection,
      currentUserId
    );
    if (
      !currentUserAuthorities ||
      !AuthorityService.canManageUsers(currentUserAuthorities)
    ) {
      connection.release();
      return NextResponse.json(
        { error: "권한 관리 권한이 없습니다." },
        { status: 403 }
      );
    }

    // 대상 사용자 존재 확인
    const targetUserAuthorities = await AuthorityService.getUserAuthorities(
      connection,
      targetUserId
    );
    if (!targetUserAuthorities) {
      connection.release();
      return NextResponse.json(
        { error: "대상 사용자를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // 권한 변경 실행
    let success = false;

    if (action === "add") {
      success = await AuthorityService.addUserAuthority(
        connection,
        targetUserId,
        authorityId,
        currentUserId
      );
    } else if (action === "remove") {
      success = await AuthorityService.removeUserAuthority(
        connection,
        targetUserId,
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
      targetUserId
    );

    connection.release();

    return NextResponse.json({
      success: true,
      message: `사용자 권한이 성공적으로 ${
        action === "add" ? "추가" : "제거"
      }되었습니다.`,
      targetUser: {
        userId: targetUserId,
        authorities: updatedAuthorities
          ? AuthorityService.formatForApi(updatedAuthorities)
          : null,
      },
    });
  } catch (error) {
    console.error("사용자 권한 관리 오류:", error);
    if (connection) connection.release();
    return NextResponse.json(
      { error: "권한 관리에 실패했습니다." },
      { status: 500 }
    );
  }
}
