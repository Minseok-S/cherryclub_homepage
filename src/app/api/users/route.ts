import { NextResponse } from "next/server";
import { pool } from "../utils/db";
import { verifyJwt } from "../utils/jwt";

/**
 * @function GET
 * @description users 테이블에서 password를 제외한 모든 유저 정보를 반환합니다. (관리자 인증 필요)
 * @param {Request} request - 인증 토큰 포함 요청
 * @returns {Object} { users: Array<UserInfo> }
 * @example
 * fetch('/api/users', { headers: { authorization: 'Bearer ...' } })
 *   .then(res => res.json())
 *   .then(data => console.log(data.users));
 */
export async function GET(request: Request) {
  const AUTH_HEADER = "authorization";
  try {
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

    const connection = await pool.getConnection();

    // 새로운 권한 체계를 위한 사용자 목록 조회
    const [usersRows] = await connection.query(
      `SELECT 
        u.id, u.name, u.gender, u.phone, u.birthday,
        rg.region, rg.group_number,
        univ.name AS university,
        u.major, u.student_id, u.grade, u.semester, u.enrollment_status,
        u.vision_camp_batch, u.ministry_status, u.is_cherry_club_member,
        u.created_at, u.isCampusLeader, u.isBranchLeader, u.isGroupLeader
      FROM users u
      LEFT JOIN Universities univ ON u.universe_id = univ.id
      LEFT JOIN region_groups rg ON u.region_group_id = rg.id
      WHERE u.region_group_id IS NOT NULL`
    );

    // 각 사용자의 권한 정보 조회
    // Frontend Design Guideline: Predictability 원칙에 따라 일관된 권한 데이터 구조 제공
    const usersWithAuthorities = [];
    for (const user of usersRows as any[]) {
      // 권한 정보를 개별적으로 조회하여 올바른 JSON 구조 보장
      const [authoritiesRows] = await connection.query(
        `SELECT 
          a.id,
          a.category_id,
          a.name,
          a.display_name,
          a.level,
          ua.is_active,
          a.created_at
        FROM user_authorities ua
        INNER JOIN authorities a ON ua.authority_id = a.id
        WHERE ua.user_id = ? AND ua.is_active = 1
        ORDER BY a.level ASC`,
        [user.id]
      );

      // Frontend Design Guideline: Predictability - 안전한 권한 데이터 구조 생성
      const authorities = (authoritiesRows as any[]).map((auth) => ({
        id: auth.id,
        category_id: auth.category_id, // snake_case 유지 (백엔드 표준)
        name: auth.name,
        display_name: auth.display_name, // snake_case 유지 (백엔드 표준)
        level: auth.level,
        is_active: auth.is_active, // snake_case 유지 (백엔드 표준)
        created_at: auth.created_at, // snake_case 유지 (백엔드 표준)
      }));

      // 권한이 없는 경우 기본 리더 권한 추가
      // Frontend Design Guideline: Single Responsibility - 기본 권한 처리 로직 분리
      if (authorities.length === 0) {
        // 기본 리더 권한 조회
        const [defaultAuthRows] = await connection.query(
          `SELECT id, category_id, name, display_name, level, is_active, created_at 
           FROM authorities 
           WHERE name = 'LEADER' AND category_id = (
             SELECT id FROM authority_categories WHERE name = 'MINISTRY'
           ) 
           LIMIT 1`
        );

        if ((defaultAuthRows as any[]).length > 0) {
          const defaultAuth = (defaultAuthRows as any[])[0];
          authorities.push({
            id: defaultAuth.id,
            category_id: defaultAuth.category_id,
            name: defaultAuth.name,
            display_name: defaultAuth.display_name,
            level: defaultAuth.level,
            is_active: true, // 기본 권한은 항상 활성화
            created_at: defaultAuth.created_at,
          });
        }
      }

      const userAuthorities = {
        userId: user.id,
        userName: user.name,
        authorities: authorities, // 이제 올바른 객체 배열
        highestAuthorityLevel:
          authorities.length > 0
            ? Math.min(...authorities.map((a) => a.level))
            : 999,
        authorityDisplayNames:
          authorities.length > 0
            ? authorities.map((a) => a.display_name).join(" / ")
            : "리더",
      };

      // 기존 사용자 정보에 권한 정보 추가
      usersWithAuthorities.push({
        ...user,
        authorities: userAuthorities,
      });
    }

    connection.release();

    return NextResponse.json({ users: usersWithAuthorities });
  } catch (error) {
    console.error("DB 검색 오류:", error);
    return NextResponse.json(
      { error: "유저 데이터 검색 실패" },
      { status: 500 }
    );
  }
}

/**
 * @function PATCH
 * @description 여러 명의 유저 권한/리더 정보를 한 번에 수정합니다. (새로운 권한 체계 적용)
 * @param {Object} req - { updates: Array<{ id: number, authorities?: number[], isCampusLeader?: number, isBranchLeader?: number, isGroupLeader?: number }> }
 * @returns {Object} { results: Array<{ id: number, success: boolean, reason?: string }> }
 * @example
 * fetch('/api/users', {
 *   method: 'PATCH',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({
 *     updates: [
 *       { id: 1, authorities: [2, 3], isCampusLeader: 0, isBranchLeader: 1, isGroupLeader: 0 },
 *       { id: 2, authorities: [1], isCampusLeader: 1, isBranchLeader: 0, isGroupLeader: 1 }
 *     ]
 *   })
 * })
 *   .then(res => res.json())
 *   .then(data => console.log(data.results));
 */
export async function PATCH(request: Request) {
  const UPDATE_FIELDS = ["isCampusLeader", "isBranchLeader", "isGroupLeader"];
  const AUTH_HEADER = "authorization";
  let connection;
  try {
    // 1. JWT 인증
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

    // 2. 요청 파싱 및 유효성 검사
    const { updates } = await request.json();
    if (!Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json(
        { error: "업데이트할 유저 정보가 없습니다." },
        { status: 400 }
      );
    }
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const results: Array<{ id: number; success: boolean; reason?: string }> =
      [];

    for (const update of updates) {
      const { id, authorities, ...fields } = update;
      if (!id) {
        results.push({
          id,
          success: false,
          reason: "id가 없습니다.",
        });
        continue;
      }

      try {
        // 1. 기존 유저 필드 업데이트 (권한 제외)
        const userFields = Object.entries(fields).filter(([key]) =>
          UPDATE_FIELDS.includes(key)
        );
        if (userFields.length > 0) {
          const setClauses = userFields.map(([key]) => `${key} = ?`);
          const values = userFields.map(([, value]) => value);
          await connection.query(
            `UPDATE users SET ${setClauses.join(", ")} WHERE id = ?`,
            [...values, id]
          );
        }

        // 2. 권한 정보 업데이트 (새로운 권한 체계)
        if (authorities && Array.isArray(authorities)) {
          // 기존 권한을 비활성화
          await connection.query(
            `UPDATE user_authorities SET is_active = 0 WHERE user_id = ?`,
            [id]
          );

          // 새로운 권한 추가
          for (const authorityId of authorities) {
            await connection.query(
              `INSERT INTO user_authorities (user_id, authority_id, is_active, assigned_at) 
               VALUES (?, ?, 1, NOW()) 
               ON DUPLICATE KEY UPDATE is_active = 1, assigned_at = NOW()`,
              [id, authorityId]
            );
          }
        }

        results.push({ id, success: true });
      } catch (err) {
        results.push({ id, success: false, reason: (err as Error).message });
      }
    }
    await connection.commit();
    connection.release();
    return NextResponse.json({ results });
  } catch (error) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    console.error("유저 정보 수정 오류:", error);
    return NextResponse.json({ error: "유저 정보 수정 실패" }, { status: 500 });
  }
}
