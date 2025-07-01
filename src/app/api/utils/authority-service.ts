import { RowDataPacket } from "mysql2";

// 권한 관련 타입 정의
export interface AuthorityCategory {
  id: number;
  name: string;
  description: string;
  created_at: Date;
}

export interface Authority {
  id: number;
  category_id: number;
  name: string;
  display_name: string;
  level: number;
  is_active: boolean;
  created_at: Date;
}

export interface UserAuthority {
  id: number;
  user_id: number;
  authority_id: number;
  assigned_at: Date;
  assigned_by?: number;
  is_active: boolean;
}

export interface UserAuthoritiesResponse {
  userId: number;
  userName: string;
  authorities: Authority[];
  highestAuthorityLevel: number;
  authorityDisplayNames: string;
}

/**
 * 권한 관리 서비스 클래스
 * Frontend Design Guideline의 Coupling 원칙에 따라 권한 로직을 독립적으로 분리
 */
export class AuthorityService {
  /**
   * 사용자의 모든 권한 정보 조회
   * Standardizing Return Types 원칙에 따라 일관된 응답 구조 제공
   */
  static async getUserAuthorities(
    connection: any,
    userId: number
  ): Promise<UserAuthoritiesResponse | null> {
    try {
      // 사용자의 권한 정보와 함께 권한 상세 정보 조회
      const [rows] = await connection.query(
        `
        SELECT 
          u.id as user_id,
          u.name as user_name,
          a.id as authority_id,
          a.name as authority_name,
          a.display_name as authority_display_name,
          a.level as authority_level,
          a.is_active as authority_is_active,
          a.created_at as authority_created_at,
          ac.id as category_id,
          ac.name as category_name,
          ua.assigned_at,
          ua.is_active as user_authority_is_active
        FROM users u
        LEFT JOIN user_authorities ua ON u.id = ua.user_id AND ua.is_active = TRUE
        LEFT JOIN authorities a ON ua.authority_id = a.id
        LEFT JOIN authority_categories ac ON a.category_id = ac.id
        WHERE u.id = ?
        ORDER BY a.level ASC
      `,
        [userId]
      );

      const userRows = rows as RowDataPacket[];
      if (userRows.length === 0) {
        return null;
      }

      const firstRow = userRows[0];
      const authorities: Authority[] = [];

      // 권한 정보가 있는 경우에만 처리
      for (const row of userRows) {
        if (row.authority_id) {
          authorities.push({
            id: row.authority_id,
            category_id: row.category_id,
            name: row.authority_name,
            display_name: row.authority_display_name,
            level: row.authority_level,
            is_active: row.authority_is_active,
            created_at: row.authority_created_at,
          });
        }
      }

      // 권한이 없는 경우 기본 리더 권한 부여
      if (authorities.length === 0) {
        const defaultAuthority = await this.getDefaultAuthority(connection);
        if (defaultAuthority) {
          authorities.push(defaultAuthority);
        }
      }

      const highestLevel =
        authorities.length > 0
          ? Math.min(...authorities.map((a) => a.level))
          : 999;

      const displayNames = authorities.map((a) => a.display_name).join(", ");

      return {
        userId: firstRow.user_id,
        userName: firstRow.user_name,
        authorities,
        highestAuthorityLevel: highestLevel,
        authorityDisplayNames: displayNames || "리더",
      };
    } catch (error) {
      console.error("사용자 권한 조회 오류:", error);
      return null;
    }
  }

  /**
   * 기본 권한 (리더) 조회
   * 권한이 없는 사용자에게 기본 권한 부여
   */
  private static async getDefaultAuthority(
    connection: any
  ): Promise<Authority | null> {
    try {
      const [rows] = await connection.query(`
        SELECT * FROM authorities 
        WHERE name = 'LEADER' AND category_id = (
          SELECT id FROM authority_categories WHERE name = 'MINISTRY'
        ) LIMIT 1
      `);

      if ((rows as RowDataPacket[]).length > 0) {
        const row = (rows as RowDataPacket[])[0];
        return {
          id: row.id,
          category_id: row.category_id,
          name: row.name,
          display_name: row.display_name,
          level: row.level,
          is_active: row.is_active,
          created_at: row.created_at,
        };
      }

      return null;
    } catch (error) {
      console.error("기본 권한 조회 오류:", error);
      return null;
    }
  }

  /**
   * 레거시 권한을 새로운 구조로 변환
   * Migration 지원을 위한 함수
   */
  private static async convertLegacyAuthority(
    connection: any,
    legacyLevel: number
  ): Promise<Authority | null> {
    try {
      const authorityNameMap: { [key: number]: string } = {
        0: "ADMIN",
        1: "NCMN_STAFF",
        2: "LEADERSHIP",
        3: "BRANCH_DIRECTOR",
        4: "TEAM_LEADER",
        5: "GROUP_LEADER",
      };

      const authorityName = authorityNameMap[legacyLevel];
      if (!authorityName) {
        // 기본 리더 권한 반환
        const [rows] = await connection.query(`
          SELECT * FROM authorities 
          WHERE name = 'LEADER' AND category_id = (
            SELECT id FROM authority_categories WHERE name = 'MINISTRY'
          ) LIMIT 1
        `);

        if ((rows as RowDataPacket[]).length > 0) {
          const row = (rows as RowDataPacket[])[0];
          return {
            id: row.id,
            category_id: row.category_id,
            name: row.name,
            display_name: row.display_name,
            level: row.level,
            is_active: row.is_active,
            created_at: row.created_at,
          };
        }
        return null;
      }

      const [rows] = await connection.query(
        `
        SELECT * FROM authorities WHERE name = ? LIMIT 1
      `,
        [authorityName]
      );

      if ((rows as RowDataPacket[]).length > 0) {
        const row = (rows as RowDataPacket[])[0];
        return {
          id: row.id,
          category_id: row.category_id,
          name: row.name,
          display_name: row.display_name,
          level: row.level,
          is_active: row.is_active,
          created_at: row.created_at,
        };
      }

      return null;
    } catch (error) {
      console.error("레거시 권한 변환 오류:", error);
      return null;
    }
  }

  /**
   * 사용자에게 권한 추가
   * 겸직을 위한 권한 추가 기능
   */
  static async addUserAuthority(
    connection: any,
    userId: number,
    authorityId: number,
    assignedBy: number
  ): Promise<boolean> {
    try {
      await connection.query(
        `
        INSERT INTO user_authorities (user_id, authority_id, assigned_by, is_active)
        VALUES (?, ?, ?, TRUE)
        ON DUPLICATE KEY UPDATE
        is_active = TRUE,
        assigned_by = VALUES(assigned_by),
        assigned_at = CURRENT_TIMESTAMP
      `,
        [userId, authorityId, assignedBy]
      );

      return true;
    } catch (error) {
      console.error("사용자 권한 추가 오류:", error);
      return false;
    }
  }

  /**
   * 사용자 권한 제거
   */
  static async removeUserAuthority(
    connection: any,
    userId: number,
    authorityId: number
  ): Promise<boolean> {
    try {
      await connection.query(
        `
        UPDATE user_authorities 
        SET is_active = FALSE 
        WHERE user_id = ? AND authority_id = ?
      `,
        [userId, authorityId]
      );

      return true;
    } catch (error) {
      console.error("사용자 권한 제거 오류:", error);
      return false;
    }
  }

  /**
   * 모든 권한 목록 조회
   */
  static async getAllAuthorities(connection: any): Promise<Authority[]> {
    try {
      const [rows] = await connection.query(`
        SELECT 
          a.id, a.category_id, a.name, a.display_name, 
          a.level, a.is_active, a.created_at
        FROM authorities a
        WHERE a.is_active = TRUE
        ORDER BY a.level ASC
      `);

      return (rows as RowDataPacket[]).map((row) => ({
        id: row.id,
        category_id: row.category_id,
        name: row.name,
        display_name: row.display_name,
        level: row.level,
        is_active: row.is_active,
        created_at: row.created_at,
      }));
    } catch (error) {
      console.error("권한 목록 조회 오류:", error);
      return [];
    }
  }

  /**
   * 권한 카테고리 목록 조회
   */
  static async getAuthorityCategories(
    connection: any
  ): Promise<AuthorityCategory[]> {
    try {
      const [rows] = await connection.query(`
        SELECT id, name, description, created_at
        FROM authority_categories
        ORDER BY id ASC
      `);

      return (rows as RowDataPacket[]).map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        created_at: row.created_at,
      }));
    } catch (error) {
      console.error("권한 카테고리 조회 오류:", error);
      return [];
    }
  }

  /**
   * 사용자 권한 확인 헬퍼 함수들
   * Readability 원칙에 따라 복잡한 조건을 명명된 함수로 분리
   */
  static hasAuthority(
    userAuthorities: UserAuthoritiesResponse,
    authorityName: string
  ): boolean {
    return userAuthorities.authorities.some(
      (auth) => auth.name === authorityName && auth.is_active
    );
  }

  static canAccessByLevel(
    userAuthorities: UserAuthoritiesResponse,
    requiredLevel: number
  ): boolean {
    return userAuthorities.highestAuthorityLevel <= requiredLevel;
  }

  static isMasterAuthority(userAuthorities: UserAuthoritiesResponse): boolean {
    return (
      this.hasAuthority(userAuthorities, "ADMIN") ||
      this.hasAuthority(userAuthorities, "NCMN_STAFF")
    );
  }

  static canManageUsers(userAuthorities: UserAuthoritiesResponse): boolean {
    return this.canAccessByLevel(userAuthorities, 4); // 팀장 이하
  }

  static canManageTraining(userAuthorities: UserAuthoritiesResponse): boolean {
    return this.canAccessByLevel(userAuthorities, 3); // 지부장 이하
  }

  /**
   * API 응답 형식으로 변환
   * Standardizing Return Types 원칙에 따라 일관된 응답 구조 제공
   * Frontend Design Guideline의 Predictability 원칙에 따라 null 값 방지
   */
  static formatForApi(userAuthorities: UserAuthoritiesResponse): any {
    return {
      userId: userAuthorities.userId ?? 0,
      userName: userAuthorities.userName ?? "",
      authorities: userAuthorities.authorities.map((auth) => ({
        id: auth.id ?? 0,
        categoryId: auth.category_id ?? 0,
        name: auth.name ?? "",
        displayName: auth.display_name ?? "권한",
        level: auth.level ?? 999,
        isActive: auth.is_active ?? true,
        createdAt: auth.created_at
          ? auth.created_at.toISOString()
          : new Date().toISOString(),
      })),
      highestAuthorityLevel: userAuthorities.highestAuthorityLevel ?? 999,
      authorityDisplayNames: userAuthorities.authorityDisplayNames ?? "리더",
      // 레거시 지원 - 첫 번째 권한의 display_name 사용
      authority: userAuthorities.authorities?.[0]?.display_name || "리더",
    };
  }
}
