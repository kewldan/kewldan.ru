"use client";

import { motion } from "motion/react";

import type { Contact as ContactContent } from "@/lib/api/generated/Contact";
import { ease, rise, stagger } from "@/lib/motion";

import { ContactForm } from "./contact-form";
import { SlideLinks } from "./work/slide-links";
import { Stage } from "./work/stage";

const GRADIENT = "linear-gradient(100deg,#ffb36b 0%,#ff5f8f 34%,#8a6bff 68%,#3fb6ff 100%)";

/** The offer, in full as soon as the stage comes into view. */
export function Contact({ contact, email }: { contact: ContactContent; email: string | null }) {
  return (
    <Stage id="contact">
      <div
        className="wrap flex min-h-130 flex-col items-center justify-center gap-5 py-slide text-center"
        style={{ "--g": GRADIENT } as React.CSSProperties}
      >
        <motion.div
          initial="hidden"
          whileInView="shown"
          viewport={{ once: true, amount: 0.3 }}
          variants={stagger(0.12)}
          className="flex flex-col items-center gap-5"
        >
          <motion.h2
            variants={{
              hidden: { opacity: 0, scale: 0.9, filter: "blur(16px)" },
              shown: { opacity: 1, scale: 1, filter: "blur(0px)", transition: { duration: 1.1, ease: ease.out } },
            }}
            className="gradient-text pb-[0.06em] text-final font-bold"
          >
            {contact.title}
          </motion.h2>
          <motion.p variants={rise} className="max-w-[42ch] text-sub font-medium text-stage-dim">
            {contact.body}
          </motion.p>
          <motion.div variants={rise}>
            <SlideLinks links={contact.links} linkClass="text-stage-link" />
          </motion.div>
          <motion.div variants={rise} className="w-full">
            <ContactForm />
          </motion.div>
          <motion.div variants={rise} className="flex flex-wrap items-center justify-center gap-x-7.5 text-[15px]">
            {contact.socials.map((s) => (
              <a key={s.href} href={s.href} className="py-2.5 text-stage-link hover:underline">
                {s.label} ›
              </a>
            ))}
            {email && (
              <a href={`mailto:${email}`} className="py-2.5 text-stage-dim select-all">
                {email}
              </a>
            )}
          </motion.div>
        </motion.div>
      </div>
    </Stage>
  );
}
