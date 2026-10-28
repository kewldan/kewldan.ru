"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

/** Neo-brutal toast: white slab, ink border, hard shadow. */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "brutal flex w-full items-center gap-3 bg-white px-4.5 py-3 font-paper text-md font-bold text-ink shadow-brutal-sm",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
