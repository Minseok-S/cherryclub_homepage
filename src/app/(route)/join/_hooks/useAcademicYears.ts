import { useState, useEffect } from "react";

export interface AcademicYear {
  year_code: string;
  display_name: string;
  full_year: number;
  is_active: boolean;
  created_at: string;
}

interface UseAcademicYearsReturn {
  academicYears: AcademicYear[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * 학번 관리 커스텀 훅
 * Frontend Design Guideline: Single Responsibility - 학번 데이터 관리만 담당
 * Frontend Design Guideline: Cohesion - 학번 관련 로직을 한 곳에 집중
 */
export function useAcademicYears(): UseAcademicYearsReturn {
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAcademicYears = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch("/api/academic-years");
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "학번 목록을 불러올 수 없습니다");
      }

      setAcademicYears(data.data);
    } catch (err) {
      console.error("학번 조회 오류:", err);
      setError(
        err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다"
      );

      // Frontend Design Guideline: Error Handling - 오류 시 폴백 데이터 제공
      setAcademicYears(getFallbackAcademicYears());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAcademicYears();
  }, []);

  const refetch = () => {
    fetchAcademicYears();
  };

  return {
    academicYears,
    loading,
    error,
    refetch,
  };
}

/**
 * 폴백 학번 데이터 (API 실패 시 사용)
 * Frontend Design Guideline: Predictability - 일관된 사용자 경험 보장
 */
function getFallbackAcademicYears(): AcademicYear[] {
  const currentYear = new Date().getFullYear();
  const currentYearCode = currentYear % 100;

  // 현재 년도 기준 전후 5년씩 생성
  const years: AcademicYear[] = [];
  for (let i = 5; i >= -5; i--) {
    const yearCode = (currentYearCode - i).toString().padStart(2, "0");
    const fullYear = currentYear - i;

    years.push({
      year_code: yearCode,
      display_name: `${yearCode}학번`,
      full_year: fullYear,
      is_active: true,
      created_at: new Date().toISOString(),
    });
  }

  return years;
}
