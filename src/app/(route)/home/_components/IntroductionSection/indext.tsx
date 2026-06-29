"use client";

import { motion } from "framer-motion";
import { Swiper, SwiperSlide } from "swiper/react";
import { EffectCoverflow, Pagination } from "swiper/modules";
import { cards } from "../../_data/IntrodeuctionData";
import IntroductionCard from "./IntroductionCard";

import "swiper/css";
import "swiper/css/effect-coverflow";
import "swiper/css/pagination";

export default function IntroductionSection() {
  return (
    <section className="py-20 sm:py-28 md:py-36 bg-white">
      <div className="container mx-auto px-8 sm:px-16 md:px-24">
        {/* 섹션 헤더 */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="flex items-center gap-3 mb-6"
        >
          <div className="w-8 h-px bg-blue-400" />
          <span className="text-blue-300 text-sm sm:text-base font-semibold tracking-widest uppercase">
            King Hero 5K
          </span>
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 1, delay: 0.2, ease: "easeOut" }}
          className="text-4xl sm:text-5xl md:text-7xl font-extrabold text-gray-900 mb-6 tracking-tighter leading-none"
        >
          5K운동을
          <br />
          주도하는 캠퍼스
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 1, delay: 0.4, ease: "easeOut" }}
          className="text-base sm:text-lg text-gray-500 leading-relaxed max-w-xl mb-16"
        >
          활동 사진을 통해 대학캠퍼스의 다양한 5K 사역 현장을 만나보세요.
        </motion.p>

        {/* 모바일: 회전목마 (coverflow) */}
        <div className="sm:hidden -mx-8">
          <Swiper
            modules={[EffectCoverflow, Pagination]}
            effect="coverflow"
            centeredSlides
            slidesPerView={1.3}
            spaceBetween={16}
            coverflowEffect={{
              rotate: 40,
              stretch: 0,
              depth: 120,
              modifier: 1,
              slideShadows: false,
            }}
            loop={true}
            pagination={{ clickable: true }}
            className="pb-10"
          >
            {cards.map((card, index) => (
              <SwiperSlide key={card.id}>
                <IntroductionCard card={card} index={index} isMobile={true} />
              </SwiperSlide>
            ))}
          </Swiper>
        </div>

        {/* 데스크톱: 벤토 그리드 */}
        <div className="hidden sm:grid sm:grid-cols-3 gap-6">
          {cards.map((card, index) => (
            <div
              key={card.id}
              className={
                index === 0
                  ? "sm:col-span-2"
                  : index === cards.length - 1 && cards.length === 3
                    ? "sm:col-span-3"
                    : "sm:col-span-1"
              }
            >
              <IntroductionCard card={card} index={index} isMobile={false} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
