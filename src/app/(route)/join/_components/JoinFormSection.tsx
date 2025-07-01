import React, { useState, useEffect, useRef } from "react";
import { useForm, SubmitHandler, Controller } from "react-hook-form";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { FormData } from "../_types/form";
import {
  GENDER_OPTIONS,
  GRADE_OPTIONS,
  SEMESTER_OPTIONS,
  REGION_OPTIONS,
} from "../_data/formOptions";
import { useAcademicYears } from "../_hooks/useAcademicYears";

/**
 * @component UniversityAutoComplete
 * @description 대학교 검색/선택/수동입력을 지원하는 오토컴플릿 컴포넌트. react-hook-form Controller로 연동.
 * @param {object} props
 * @param {string} props.value 현재 값
 * @param {(value: string) => void} props.onChange 값 변경 핸들러
 * @param {string} props.error 에러 메시지
 * @example <UniversityAutoComplete value={value} onChange={setValue} error={error} />
 * @test
 * - 검색어 입력 시 API 호출 및 결과 노출 확인
 * - 결과 선택/직접입력 동작 확인
 * - 에러 메시지 노출 확인
 */
function UniversityAutoComplete({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  const [inputValue, setInputValue] = useState(value || "");
  const [options, setOptions] = useState<{ name: string; country: string }[]>(
    []
  );
  const [showOptions, setShowOptions] = useState(false);
  const [isManual, setIsManual] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null); // 디바운스 타이머 ref

  // 검색어 변경 시 API 호출 (디바운싱 적용)
  useEffect(() => {
    if (isManual || inputValue.trim().length < 2) {
      setOptions([]);
      setNotFound(false);
      return;
    }
    // 기존 타이머 제거
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // 300ms 후에만 fetch 호출
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      fetch(`/api/join/university?query=${encodeURIComponent(inputValue)}`)
        .then((res) => res.json())
        .then((data) => {
          setOptions(data);
          setNotFound(data.length === 0);
        })
        .catch(() => setOptions([]))
        .finally(() => setLoading(false));
    }, 300);
    // 언마운트/입력 변경 시 타이머 정리
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [inputValue, isManual]);

  // 외부 value 변경 시 inputValue 동기화
  useEffect(() => {
    if (isManual) {
      if (value?.startsWith("(기타) ")) {
        setInputValue(value.slice(5));
      } else {
        setInputValue("");
      }
    } else {
      setInputValue(value || "");
    }
  }, [value, isManual]);

  // 옵션 선택 시
  const handleSelect = (name: string) => {
    onChange(name);
    setInputValue(name);
    setShowOptions(false);
    setIsManual(false);
  };

  // 직접입력 모드
  const handleManual = () => {
    setIsManual(true);
    setShowOptions(false);
    setOptions([]);
    setInputValue("");
    onChange("");
  };

  return (
    <div className="relative">
      <input
        type="text"
        className={`w-full px-4 py-2 border ${
          error ? "border-red-500" : "border-gray-300"
        } rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors`}
        placeholder="대학교 검색"
        value={inputValue}
        onChange={(e) => {
          setInputValue(e.target.value);
          onChange(e.target.value);
          setIsManual(false);
          setShowOptions(true);
        }}
        onFocus={() => setShowOptions(true)}
        autoComplete="off"
        disabled={isManual}
      />
      {/* 검색 결과 드롭다운 */}
      {showOptions && !isManual && inputValue.trim().length >= 2 && (
        <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow mt-1 max-h-60 overflow-auto">
          {loading && (
            <div className="p-3 text-gray-500 text-sm">검색 중...</div>
          )}
          {!loading &&
            options.map((opt) => (
              <button
                type="button"
                key={opt.name}
                className="block w-full text-left px-4 py-2 hover:bg-blue-50"
                onClick={() => handleSelect(opt.name)}
              >
                {opt.name}{" "}
                <span className="text-xs text-gray-400 ml-2">
                  {opt.country}
                </span>
              </button>
            ))}
          {!loading && notFound && (
            <div className="p-3 text-gray-500 text-sm">
              검색 결과가 없습니다.
            </div>
          )}
          {!loading && (
            <button
              type="button"
              className="block w-full text-left px-4 py-2 text-blue-600 hover:bg-blue-50 border-t border-gray-100"
              onClick={handleManual}
            >
              학교가 목록에 없어요 (직접 입력)
            </button>
          )}
        </div>
      )}
      {/* 직접입력 모드 */}
      {isManual && (
        <div>
          <input
            type="text"
            className={`w-full mt-2 px-4 py-2 border ${
              error ? "border-red-500" : "border-gray-300"
            } rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors`}
            placeholder="학교명을 직접 입력하세요"
            value={inputValue}
            onChange={(e) => {
              const prefix = "(기타) ";
              setInputValue(e.target.value); // input에는 prefix 없는 값만 보여줌
              if (e.target.value.trim() === "") {
                onChange("");
              } else {
                onChange(prefix + e.target.value);
              }
            }}
            autoFocus
          />
          {/* 검색 모드로 돌아가기 버튼 */}
          <button
            type="button"
            className="mt-2 w-full px-4 py-2 text-blue-600 bg-blue-50 rounded-lg border border-blue-100 hover:bg-blue-100 text-sm"
            onClick={() => {
              setIsManual(false);
              setInputValue("");
              onChange("");
              setShowOptions(false); // 검색 input에 포커스 시 자동으로 드롭다운 열림
            }}
          >
            학교 검색으로 돌아가기
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
    </div>
  );
}

// 전화번호 하이픈 자동 변환 함수
function formatPhoneNumber(value: string) {
  // 숫자만 남기기
  const numbersOnly = value.replace(/[^0-9]/g, "");
  if (numbersOnly.length < 4) return numbersOnly;
  if (numbersOnly.length < 8)
    return numbersOnly.replace(/(\d{3})(\d{1,4})/, "$1-$2");
  return numbersOnly.replace(/(\d{3})(\d{4})(\d{1,4})/, "$1-$2-$3");
}

// 학번 검증 함수 (DB 기반)
// Frontend Design Guideline: Predictability - DB에서 가져온 유효한 학번만 허용
function validateStudentId(value: string, validYearCodes: string[] = []) {
  if (!value) return "학번을 선택해주세요";
  if (!validYearCodes.includes(value)) {
    return "유효하지 않은 학번입니다";
  }
  return true;
}

// 생년월일 자동 변환 함수
function formatBirthdayInput(value: string) {
  // 이미 하이픈이 있으면 그대로
  if (/\d{4}-\d{2}-\d{2}/.test(value)) return value;
  // 8자리 숫자면 YYYY-MM-DD로 변환
  const onlyNum = value.replace(/[^0-9]/g, "");
  if (onlyNum.length === 8) {
    return `${onlyNum.slice(0, 4)}-${onlyNum.slice(4, 6)}-${onlyNum.slice(
      6,
      8
    )}`;
  }
  return value;
}

/**
 * @component JoinFormSection
 * @description 동아리 가입신청 폼 전체를 담당하는 컴포넌트입니다.
 * @example
 * <JoinFormSection />
 * @test
 * - 폼이 정상적으로 렌더링되는지 확인
 * - 각 필드/옵션이 올바르게 표시되는지 확인
 * - 제출/완료/에러 상태가 정상 동작하는지 확인
 */
const JoinFormSection: React.FC = () => {
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // DB에서 학번 데이터 가져오기
  // Frontend Design Guideline: Cohesion - 학번 관련 로직을 한 곳에 집중
  const {
    academicYears,
    loading: academicYearsLoading,
    error: academicYearsError,
  } = useAcademicYears();

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    control,
  } = useForm<FormData>();

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const animations = gsap.context(() => {
      gsap.utils.toArray(".gsap-fade-in").forEach((element: any) => {
        gsap.fromTo(
          element,
          { opacity: 0, y: 50 },
          {
            opacity: 1,
            y: 0,
            duration: 0.8,
            scrollTrigger: {
              trigger: element,
              start: "top 80%",
              toggleActions: "play none none reverse",
            },
          }
        );
      });
    });
    return () => animations.revert();
  }, []);

  const onSubmit: SubmitHandler<FormData> = async (data) => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch("/api/join/new-join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok) {
        setSubmitError(result.error || "알 수 없는 오류가 발생했습니다.");
        setIsSubmitting(false);
        return;
      }
      setIsSubmitted(true);
      reset();
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <section className="py-20 bg-white">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto bg-green-100 border border-green-400 text-green-700 px-8 py-10 rounded-xl text-center mb-8">
            <svg
              className="w-16 h-16 mx-auto mb-4 text-green-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M5 13l4 4L19 7"
              ></path>
            </svg>
            <h2 className="text-2xl font-bold mb-4">
              가입신청이 완료되었습니다!
            </h2>
            <p className="mb-4">
              NCMN 동아리 가입 신청서가 성공적으로 제출되었습니다. 입력하신
              연락처로 추가 안내사항을 보내드릴 예정이니 확인해주세요.
            </p>
            <button
              onClick={() => setIsSubmitted(false)}
              className="mt-4 bg-green-600 text-white px-6 py-2 rounded-full hover:bg-green-700 transition-colors"
            >
              다시 작성하기
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-white">
      <div className="container mx-auto px-4">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12 gsap-fade-in">
            <h2 className="text-3xl font-bold mb-4">가입신청서 작성</h2>
            <p className="text-gray-600">
              아래 양식을 작성하여 NCMN 동아리 가입을 신청해주세요. 모든 항목은
              필수 입력사항입니다.
            </p>
          </div>
          {submitError && (
            <div className="mb-6 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg text-center">
              {submitError}
            </div>
          )}
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-6 gsap-fade-in"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label
                  htmlFor="name"
                  className="block mb-2 font-medium text-gray-700"
                >
                  이름
                </label>
                <input
                  type="text"
                  id="name"
                  className={`w-full px-4 py-2 border ${
                    errors.name ? "border-red-500" : "border-gray-300"
                  } rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors`}
                  placeholder="홍길동"
                  {...register("name", { required: "이름을 입력해주세요" })}
                />
                {errors.name && (
                  <p className="mt-1 text-sm text-red-500">
                    {errors.name.message as string}
                  </p>
                )}
              </div>
              <div>
                <label
                  htmlFor="gender"
                  className="block mb-2 font-medium text-gray-700"
                >
                  성별
                </label>
                <select
                  id="gender"
                  className={`w-full px-4 py-2 border ${
                    errors.gender ? "border-red-500" : "border-gray-300"
                  } rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors`}
                  {...register("gender", { required: "성별을 선택해주세요" })}
                >
                  {GENDER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {errors.gender && (
                  <p className="mt-1 text-sm text-red-500">
                    {errors.gender.message as string}
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label
                  htmlFor="phone"
                  className="block mb-2 font-medium text-gray-700"
                >
                  연락처
                </label>
                <Controller
                  name="phone"
                  control={control}
                  rules={{
                    required: "연락처를 입력해주세요",
                    pattern: {
                      value: /^010-\d{4}-\d{4}$/,
                      message: "올바른 전화번호 형식이 아닙니다",
                    },
                  }}
                  render={({ field }) => (
                    <input
                      type="tel"
                      id="phone"
                      className={`w-full px-4 py-2 border ${
                        errors.phone ? "border-red-500" : "border-gray-300"
                      } rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors`}
                      placeholder="010-1234-5678"
                      value={field.value || ""}
                      onChange={(e) => {
                        const formatted = formatPhoneNumber(e.target.value);
                        field.onChange(formatted);
                      }}
                      maxLength={13}
                      autoComplete="tel"
                    />
                  )}
                />
                {errors.phone && (
                  <p className="mt-1 text-sm text-red-500">
                    {errors.phone.message as string}
                  </p>
                )}
              </div>
              <div>
                <label
                  htmlFor="birthday"
                  className="block mb-2 font-medium text-gray-700"
                >
                  생년월일
                </label>
                <Controller
                  name="birthday"
                  control={control}
                  rules={{
                    required: "생년월일을 입력해주세요",
                    validate: (value) => {
                      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
                        return "YYYY-MM-DD 형식으로 입력해주세요";
                      }
                      const [year, month, day] = value.split("-").map(Number);
                      if (year < 2000) {
                        return "2000년 이후만 입력 가능합니다";
                      }
                      if (month < 1 || month > 12 || day < 1 || day > 31) {
                        return "올바른 날짜를 입력해주세요";
                      }
                      return true;
                    },
                  }}
                  render={({ field }) => (
                    <input
                      type="text"
                      id="birthday"
                      placeholder="예) 2001-05-23"
                      className={`w-full px-4 py-2 border ${
                        errors.birthday ? "border-red-500" : "border-gray-300"
                      } rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors`}
                      value={field.value || ""}
                      onChange={(e) => {
                        const formatted = formatBirthdayInput(e.target.value);
                        field.onChange(formatted);
                      }}
                      maxLength={10}
                    />
                  )}
                />
                {errors.birthday && (
                  <p className="mt-1 text-sm text-red-500">
                    {errors.birthday.message as string}
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label
                  htmlFor="university"
                  className="block mb-2 font-medium text-gray-700"
                >
                  학교
                </label>
                <Controller
                  name="university"
                  control={control}
                  rules={{ required: "학교를 입력해주세요" }}
                  render={({ field }) => (
                    <UniversityAutoComplete
                      value={field.value}
                      onChange={field.onChange}
                      error={errors.university?.message as string}
                    />
                  )}
                />
              </div>
              <div>
                <label
                  htmlFor="major"
                  className="block mb-2 font-medium text-gray-700"
                >
                  전공
                </label>
                <input
                  type="text"
                  id="major"
                  className={`w-full px-4 py-2 border ${
                    errors.major ? "border-red-500" : "border-gray-300"
                  } rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors`}
                  placeholder="OO학과"
                  {...register("major", { required: "전공을 입력해주세요" })}
                />
                {errors.major && (
                  <p className="mt-1 text-sm text-red-500">
                    {errors.major.message as string}
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label
                  htmlFor="student_id"
                  className="block mb-2 font-medium text-gray-700"
                >
                  학번
                  {academicYearsLoading && (
                    <span className="text-sm text-gray-500 ml-2">
                      불러오는 중...
                    </span>
                  )}
                  {academicYearsError && (
                    <span className="text-sm text-red-500 ml-2">오류 발생</span>
                  )}
                </label>
                <Controller
                  name="student_id"
                  control={control}
                  rules={{
                    validate: (value) =>
                      validateStudentId(
                        value,
                        academicYears.map((year) => year.year_code)
                      ),
                  }}
                  render={({ field }) => (
                    <select
                      id="student_id"
                      className={`w-full px-4 py-2 border ${
                        errors.student_id ? "border-red-500" : "border-gray-300"
                      } rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors`}
                      value={field.value || ""}
                      onChange={field.onChange}
                      disabled={academicYearsLoading}
                    >
                      <option value="">학번 선택</option>
                      {academicYears.map((year) => (
                        <option key={year.year_code} value={year.year_code}>
                          {year.display_name}
                        </option>
                      ))}
                    </select>
                  )}
                />
                {errors.student_id && (
                  <p className="mt-1 text-sm text-red-500">
                    {errors.student_id.message as string}
                  </p>
                )}
              </div>
              <div>
                <label
                  htmlFor="region"
                  className="block mb-2 font-medium text-gray-700"
                >
                  지역
                </label>
                <select
                  id="region"
                  className={`w-full px-4 py-2 border ${
                    errors.region ? "border-red-500" : "border-gray-300"
                  } rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors`}
                  {...register("region", { required: "지역을 선택해주세요" })}
                >
                  {REGION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {errors.region && (
                  <p className="mt-1 text-sm text-red-500">
                    {errors.region.message as string}
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label
                  htmlFor="grade"
                  className="block mb-2 font-medium text-gray-700"
                >
                  학년
                </label>
                <select
                  id="grade"
                  className={`w-full px-4 py-2 border ${
                    errors.grade ? "border-red-500" : "border-gray-300"
                  } rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors`}
                  {...register("grade", { required: "학년을 선택해주세요" })}
                >
                  {GRADE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {errors.grade && (
                  <p className="mt-1 text-sm text-red-500">
                    {errors.grade.message as string}
                  </p>
                )}
              </div>
              <div>
                <label
                  htmlFor="semester"
                  className="block mb-2 font-medium text-gray-700"
                >
                  학기
                </label>
                <select
                  id="semester"
                  className={`w-full px-4 py-2 border ${
                    errors.semester ? "border-red-500" : "border-gray-300"
                  } rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors`}
                  {...register("semester", { required: "학기를 선택해주세요" })}
                >
                  {SEMESTER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {errors.semester && (
                  <p className="mt-1 text-sm text-red-500">
                    {errors.semester.message as string}
                  </p>
                )}
              </div>
            </div>
            <div>
              <label
                htmlFor="message"
                className="block mb-2 font-medium text-gray-700"
              >
                가입 동기
              </label>
              <textarea
                id="message"
                rows={5}
                className={`w-full px-4 py-2 border ${
                  errors.message ? "border-red-500" : "border-gray-300"
                } rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors`}
                placeholder="NCMN 동아리에 가입하고자 하는 동기를 자유롭게 작성해주세요."
                {...register("message")}
              ></textarea>
              {errors.message && (
                <p className="mt-1 text-sm text-red-500">
                  {errors.message.message as string}
                </p>
              )}
            </div>
            <div className="flex items-start">
              <div className="flex items-center h-5">
                <input
                  id="agree"
                  type="checkbox"
                  className="w-4 h-4 border border-gray-300 rounded bg-gray-50 focus:ring-3 focus:ring-blue-300"
                  {...register("agree", {
                    required: "개인정보 수집에 동의해주세요",
                  })}
                />
              </div>
              <label htmlFor="agree" className="ml-2 text-sm text-gray-600">
                개인정보 수집 및 이용에 동의합니다.
              </label>
            </div>
            {errors.agree && (
              <p className="mt-1 text-sm text-red-500">
                {errors.agree.message as string}
              </p>
            )}
            <div className="text-center">
              <button
                type="submit"
                disabled={isSubmitting}
                className={`px-8 py-3 bg-blue-600 text-white rounded-full font-medium text-lg hover:bg-blue-700 transition-colors ${
                  isSubmitting ? "opacity-70 cursor-not-allowed" : ""
                }`}
              >
                {isSubmitting ? "제출 중..." : "가입 신청하기"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
};

export default JoinFormSection;
