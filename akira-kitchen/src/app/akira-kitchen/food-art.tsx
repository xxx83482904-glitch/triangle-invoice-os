import { useId, type Ref } from "react";
import { BASES, type FoodId, type Recipe } from "./model";

function Face({ y = 58 }: { y?: number }) {
  return <g fill="none" stroke="#574534" strokeWidth="2.5" strokeLinecap="round"><path d={`M35 ${y}q3-5 6 0M59 ${y}q3-5 6 0M45 ${y + 9}q5 5 10 0`} /><ellipse cx="31" cy={y + 7} rx="5" ry="3" fill="#ecaaa0" stroke="none" /><ellipse cx="69" cy={y + 7} rx="5" ry="3" fill="#ecaaa0" stroke="none" /></g>;
}

// Small code-native food illustrations also render into exported artwork.
export function FoodShape({ food }: { food: FoodId }) {
  switch (food) {
    case "rice": return <g><path d="M43 13Q50 5 58 15L91 68Q99 85 81 89H19Q2 87 10 71Z" fill="#e4ddc8" /><path d="M43 9Q50 2 58 12L90 64Q98 81 80 85H20Q3 83 11 67Z" fill="#fffcf0" stroke="#d8cfb7" strokeWidth="1.5" /><path d="M35 71Q50 68 66 71L67 85H34Z" fill="#40533e" /><path d="m28 37 3-4m41 10 2 4M22 63l2-3M60 28l3 2M46 23l-1 3" stroke="#e3dcc9" strokeWidth="2" strokeLinecap="round" /><Face y={49} /></g>;
    case "egg": return <g transform="rotate(-12 50 50)"><rect x="12" y="24" width="72" height="54" rx="16" fill="#dfa340" /><rect x="10" y="18" width="72" height="52" rx="16" fill="#f5c958" /><rect x="14" y="20" width="28" height="47" rx="12" fill="#ffe28c" /><path d="M26 27c-14 7-5 33 5 31 12-2 5-26-3-22-7 3-3 16 2 14" stroke="#eeb546" strokeWidth="4" fill="none" strokeLinecap="round" /><path d="M53 23v38M65 24v37" stroke="#fbe094" strokeWidth="3" /><ellipse cx="67" cy="68" rx="9" ry="3" fill="#bb8229" opacity=".15" /></g>;
    case "broccoli": return <g><path d="m43 49-7 36q14 8 28-1l-9-34Z" fill="#a2bd69" /><path d="m49 57-9 20m11-20 9 17" stroke="#6c954f" strokeWidth="3" /><path d="M13 50c-10-18 9-36 24-29C40 3 65 6 71 23c22-3 28 24 13 33-3 18-27 18-36 8-17 12-36 1-35-14Z" fill="#5a8d50" /><circle cx="31" cy="37" r="16" fill="#78a760" /><circle cx="53" cy="29" r="17" fill="#76a65a" /><circle cx="72" cy="40" r="15" fill="#6b9d56" /><g fill="#93b674"><circle cx="26" cy="30" r="3" /><circle cx="50" cy="19" r="3" /><circle cx="64" cy="36" r="3" /><circle cx="32" cy="50" r="3" /></g></g>;
    case "tomato": return <g><circle cx="50" cy="54" r="34" fill="#ce5545" /><ellipse cx="47" cy="50" rx="31" ry="32" fill="#e9745f" /><path d="m50 14 7 16 17-3-13 12 5 15-16-10-15 9 5-17-14-8 18-1Z" fill="#658950" /><path d="m49 31 3-18" stroke="#4e7742" strokeWidth="4" strokeLinecap="round" /><path d="M27 47q-5 12 2 19" stroke="#ffa491" strokeWidth="5" strokeLinecap="round" fill="none" /></g>;
    case "shrimp": return <g transform="rotate(25 50 50)"><path d="M38 23 30 5q15-3 21 14Q60 2 69 11L58 29Z" fill="#df7860" /><path d="M40 22c29-1 40 58 9 65C17 93 18 51 29 34Z" fill="#dc9c46" /><path d="M37 24c27-1 34 53 10 58C20 86 22 45 37 24Z" fill="#efbd63" /><g fill="#ffe09a"><circle cx="43" cy="35" r="4" /><circle cx="34" cy="47" r="4" /><circle cx="51" cy="51" r="4" /><circle cx="36" cy="67" r="4" /><circle cx="53" cy="70" r="3" /></g></g>;
    case "carrot": return <g><path d="M49 17c13-19 31 0 24 13 23-2 28 23 9 31 13 19-10 34-23 22-10 20-33 10-31-8C7 83-2 55 17 45 1 26 28 10 39 24Z" fill="#e99c4b" /><path d="M49 22c10-14 23 0 17 11 17-1 24 15 7 24 10 16-6 26-18 16-8 14-23 8-22-8C16 71 8 51 25 43 12 29 30 19 40 32Z" fill="#f4b365" /><circle cx="47" cy="49" r="10" fill="#e89949" /><path d="m47 38 2 20m-12-9 19 1" stroke="#f9c782" strokeWidth="2" /></g>;
    case "sausage": return <g><path d="M28 54V31c0-28 44-28 44 0v23l12 23q3 12-9 10L62 67l1 22q-4 11-12 0l-4-22-8 23q-8 8-11-2l8-23-14 18Q10 88 14 75Z" fill="#ca6b59" /><path d="M31 48V30c0-23 34-23 37 0v18Z" fill="#e28b75" /><path d="M35 23q3-8 11-8" fill="none" stroke="#f1b3a0" strokeWidth="4" strokeLinecap="round" /><Face y={42} /></g>;
    case "peas": return <g transform="rotate(-30 50 50)"><path d="M9 53Q43 14 91 44 70 90 20 72Z" fill="#6d9a54" /><path d="M14 53Q50 24 86 45 62 71 20 68Z" fill="#a7c579" /><circle cx="31" cy="55" r="12" fill="#b9d68e" /><circle cx="52" cy="49" r="12" fill="#b8d58b" /><circle cx="73" cy="47" r="10" fill="#bddb90" /><path d="m19 69-6 5m72-31 6-4" stroke="#5b8844" strokeWidth="3" /></g>;
    case "strawberry": return <g><path d="M17 35C14 13 42 10 50 22 62 7 88 16 84 39 81 60 65 83 51 92 34 83 20 61 17 35Z" fill="#c95750" /><path d="M18 31C19 13 41 15 50 25 64 13 83 17 81 34 77 55 65 77 50 87 34 76 21 55 18 31Z" fill="#e57769" /><path d="m49 23-15-9 5 14-16 3 21 6 8-8 13 8 15-11-19-2 4-14Z" fill="#6d9458" /><g fill="#ffe3a8"><ellipse cx="33" cy="42" rx="2" ry="3" transform="rotate(-20 33 42)" /><ellipse cx="52" cy="45" rx="2" ry="3" /><ellipse cx="69" cy="40" rx="2" ry="3" /><ellipse cx="41" cy="60" rx="2" ry="3" /><ellipse cx="61" cy="59" rx="2" ry="3" /><ellipse cx="51" cy="76" rx="2" ry="3" /></g></g>;
    case "blueberry": return <g><circle cx="35" cy="56" r="24" fill="#75718b" /><circle cx="65" cy="57" r="24" fill="#69667f" /><circle cx="49" cy="32" r="24" fill="#8d89a1" /><path d="m48 18 4 7 9 1-7 6 2 8-8-5-8 5 2-9-6-5 9-1Z" fill="#625d78" /><path d="M20 51q1-7 7-9M51 17q-8 0-12 7M70 44l3 3" stroke="#b0a9bf" strokeWidth="4" fill="none" strokeLinecap="round" /></g>;
    case "cream": return <g><path d="M14 74c-8-15 10-18 11-27 0-11 15-12 16-20 2-10 13-12 13-24 25 16 9 26 22 37 7 5 4 14 13 21 17 28-63 41-75 13Z" fill="#e8ddc5" /><path d="M15 68c-5-13 12-18 12-26 2-10 15-10 17-19 1-8 10-10 10-20 15 14 7 24 17 34 7 5 4 14 13 21 13 24-56 36-69 10Z" fill="#fffdf2" /><path d="M30 62q26 10 44-5M39 43q14 8 28-4M47 26q8 4 12-3" stroke="#f0e8d7" strokeWidth="5" fill="none" strokeLinecap="round" /></g>;
    case "kiwi": return <g transform="rotate(-15 50 50)"><ellipse cx="50" cy="51" rx="39" ry="33" fill="#9a8c62" /><ellipse cx="50" cy="48" rx="37" ry="31" fill="#a4be73" /><ellipse cx="50" cy="48" rx="28" ry="24" fill="#bbcf8b" /><ellipse cx="50" cy="48" rx="12" ry="16" fill="#e9e9b7" />{Array.from({ length: 12 }, (_, i) => <ellipse key={i} cx={50 + Math.cos(i * Math.PI / 6) * 21} cy={48 + Math.sin(i * Math.PI / 6) * 19} rx="1.5" ry="2.5" fill="#5d6146" transform={`rotate(${i * 30} ${50 + Math.cos(i * Math.PI / 6) * 21} ${48 + Math.sin(i * Math.PI / 6) * 19})`} />)}</g>;
    case "orange": return <g transform="rotate(15 50 50)"><path d="M10 34h80a40 40 0 0 1-80 0Z" fill="#e8a255" /><path d="M15 34h70a35 35 0 0 1-70 0Z" fill="#ffe4ae" /><path d="M21 38h58a29 29 0 0 1-58 0Z" fill="#f5bb65" /><path d="m50 36-21 19m21-19v27m0-27 22 19" stroke="#ffe4ae" strokeWidth="3" /></g>;
    case "star": return <g><path d="m50 9 12 26 29 4-21 21 5 30-25-14-26 14 5-30L8 39l29-4Z" fill="#dba34e" /><path d="m50 5 12 26 29 4-21 21 5 30-25-14-26 14 5-30L8 35l29-4Z" fill="#f3c76e" /><path d="m49 20-8 17-18 2" fill="none" stroke="#ffe3a0" strokeWidth="4" strokeLinecap="round" /></g>;
    case "heart": return <g><path d="M50 90C32 77 5 56 10 31 15 8 39 9 50 24 67 3 90 16 91 36 92 59 65 80 50 90Z" fill="#cb7f87" /><path d="M50 84C32 71 5 50 10 25 15 2 39 3 50 18 67-3 90 10 91 30 92 53 65 74 50 84Z" fill="#e4a2a6" /><path d="M22 29c0-9 9-13 16-7" stroke="#f4c5c6" strokeWidth="5" fill="none" strokeLinecap="round" /></g>;
  }
}

export function FoodArt({ food, className }: { food: FoodId; className?: string }) {
  return <svg viewBox="0 0 100 100" className={className} aria-hidden="true"><FoodShape food={food} /></svg>;
}

export function DishArt({ recipe, className, hideItems = false, svgRef, label }: { recipe: Recipe; className?: string; hideItems?: boolean; svgRef?: Ref<SVGSVGElement>; label?: string }) {
  const id = useId().replace(/:/g, "");
  const isBento = recipe.mode === "bento";
  const color = BASES[recipe.mode].find((base) => base.id === recipe.base)?.color ?? BASES[recipe.mode][0].color;
  const size = isBento ? 104 : 78;
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 440" className={className} ref={svgRef} role={label ? "img" : undefined} aria-label={label} aria-hidden={!label}>
    <defs><filter id={`${id}-shadow`} x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="10" stdDeviation="9" floodColor="#775535" floodOpacity=".12" /></filter><linearGradient id={`${id}-box`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#fff" stopOpacity=".2" /><stop offset="1" stopColor="#5c3120" stopOpacity=".07" /></linearGradient></defs>
    {isBento ? <g filter={`url(#${id}-shadow)`}>
      <rect x="67" y="76" width="466" height="309" rx="78" fill={color} />
      <rect x="67" y="59" width="466" height="309" rx="78" fill={color} />
      <rect x="67" y="59" width="466" height="309" rx="78" fill={`url(#${id}-box)`} />
      <rect x="83" y="75" width="434" height="273" rx="64" fill="#fff8e5" stroke="#fff" strokeOpacity=".6" strokeWidth="4" />
      <rect x="92" y="85" width="416" height="253" rx="58" fill="#f3e8cc" />
      <path d="M324 87v250" stroke="#d4b998" strokeWidth="9" strokeLinecap="round" />
      <path d="M324 87v250" stroke="#fff5e0" strokeWidth="5" strokeLinecap="round" />
      <path d="M101 116q13-29 47-29" fill="none" stroke="#fffaf0" strokeWidth="4" strokeLinecap="round" />
    </g> : <g filter={`url(#${id}-shadow)`}>
      <ellipse cx="300" cy="325" rx="231" ry="83" fill="#a1b9a1" />
      <ellipse cx="300" cy="316" rx="231" ry="82" fill="#c3d4b9" />
      <ellipse cx="300" cy="314" rx="211" ry="67" fill="none" stroke="#e3ead5" strokeWidth="3" />
      <path d="M111 186v94c0 101 378 101 378 0v-94Z" fill={color} />
      <path d="M111 238v27c0 97 378 97 378 0v-27c-18 98-359 93-378 0Z" fill="#fff9e8" />
      <path d="M117 263c22 70 347 75 367 0" fill="none" stroke="#d97e77" strokeWidth="9" strokeDasharray="21 20" />
      <path d="M111 181v38c0 21 16 33 28 17 8 30 24 28 36 15 4 32 29 39 42 19 15 27 37 30 53 8 19 26 42 21 56 0 15 20 39 17 50-8 16 17 38 11 43-15 17 12 34 5 38-18 16 12 32-3 32-23v-33Z" fill="#fffbed" />
      <ellipse cx="300" cy="183" rx="189" ry="118" fill="#fffdf2" />
      <ellipse cx="300" cy="183" rx="171" ry="103" fill="none" stroke="#f4edda" strokeWidth="3" strokeDasharray="4 9" />
      <path d="M161 128q24-24 53-30" stroke="#fff" strokeWidth="6" fill="none" strokeLinecap="round" />
    </g>}
    {!hideItems && recipe.items.map((piece) => <g key={piece.id} transform={`translate(${piece.x * 6} ${piece.y * 4.4}) rotate(${piece.rotation}) translate(${-size / 2} ${-size / 2}) scale(${size / 100})`}><FoodShape food={piece.food} /></g>)}
  </svg>;
}

export function RainbowArt({ className }: { className?: string }) {
  return <svg viewBox="0 0 120 90" className={className} aria-hidden="true"><path d="M12 73a48 48 0 0 1 96 0" fill="none" stroke="#d88c74" strokeWidth="12" strokeLinecap="round" /><path d="M27 73a33 33 0 0 1 66 0" fill="none" stroke="#e8c175" strokeWidth="11" strokeLinecap="round" /><path d="M42 73a18 18 0 0 1 36 0" fill="none" stroke="#8fac8a" strokeWidth="10" strokeLinecap="round" /><g fill="#fffdf3"><ellipse cx="18" cy="78" rx="17" ry="9" /><ellipse cx="102" cy="78" rx="17" ry="9" /></g></svg>;
}
