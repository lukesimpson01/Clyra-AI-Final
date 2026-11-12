import { motion, AnimatePresence } from "framer-motion";

/** Vibe preview pointer: same tailless 16px Clyra blue control point. */
export function AgentCursor({ x, y, isClicking, isActive }: {
  x: number; y: number; isClicking: boolean; isActive: boolean;
}) {
  return <AnimatePresence>
    {isActive && <motion.div
      aria-hidden
      className="pointer-events-none absolute z-50"
      initial={{ opacity: 0, x, y }}
      animate={{ opacity: 1, x, y }}
      exit={{ opacity: 0 }}
      transition={{ x: { type: "spring", stiffness: 430, damping: 38, mass: .38 }, y: { type: "spring", stiffness: 430, damping: 38, mass: .38 }, opacity: { duration: .12 } }}
      style={{ left: 0, top: 0 }}
    >
      <motion.div
        className="absolute -left-2 -top-2 h-4 w-4 rounded-full border-2 border-white bg-[#1E6FFF] shadow-[0_2px_9px_rgba(30,111,255,0.32)]"
        animate={{ scale: isClicking ? .77 : 1 }}
        transition={{ duration: .12 }}
      />
      <AnimatePresence>
        {isClicking && <motion.div
          key="click"
          className="absolute -left-4 -top-4 h-8 w-8 rounded-full border-2 border-blue-400"
          initial={{ opacity: .7, scale: .45 }}
          animate={{ opacity: 0, scale: 1.65 }}
          exit={{ opacity: 0 }}
          transition={{ duration: .42, ease: "easeOut" }}
        />}
      </AnimatePresence>
    </motion.div>}
  </AnimatePresence>;
}
