/** 手绘太阳、云朵与纸飞机是轻量矢量装饰，和真实地图边界分层绘制。 */
export function TravelDoodles() {
  return <div className="travel-doodles" aria-hidden="true">
    <svg className="doodle-sun" viewBox="0 0 100 100" fill="none">
      <path d="M49 25C65 23 78 36 76 52C75 67 65 77 49 76C33 76 24 65 25 49C25 35 35 26 49 25Z" fill="#f4d68b" stroke="#b9945c" strokeWidth="1.7" />
      <path d="m49 7 1 10m-1 67 1 10M7 49l10 1m67 1 10-1M19 19l8 7m48 49 7 7M19 82l8-7m48-49 7-8" stroke="#c5a46a" strokeWidth="2" strokeLinecap="round" />
      <path d="M39 47v3m21-3v3m-21 9q10 11 20-1" stroke="#8f7955" strokeWidth="2.5" strokeLinecap="round" />
      <ellipse cx="33" cy="55" rx="5" ry="2.5" fill="#e4ad88" opacity=".7" /><ellipse cx="65" cy="55" rx="5" ry="2.5" fill="#e4ad88" opacity=".7" />
    </svg>
    <svg className="doodle-cloud cloud-one" viewBox="0 0 150 72" fill="none">
      <path d="M21 57C4 56 7 34 24 32C22 9 54 5 64 23C78 9 104 16 104 34C127 24 145 47 131 58C111 66 42 64 21 57Z" fill="#fffdf4" stroke="#b4b79f" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M31 60q41 4 89-1" stroke="#d4d1bc" strokeWidth="1" />
    </svg>
    <svg className="doodle-cloud cloud-two" viewBox="0 0 150 72" fill="none">
      <path d="M19 58C4 53 10 34 27 34C29 13 55 12 65 29C77 16 102 21 105 39C127 31 143 48 132 59C104 65 46 65 19 58Z" fill="#fffdf6" stroke="#b4b79f" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    <svg className="doodle-plane" viewBox="0 0 180 90" fill="none">
      <path d="M5 68C54 90 35 17 79 42C100 56 78 77 69 65C59 52 105 47 128 31" stroke="#b5a78b" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="4 6" />
      <path d="m129 21 43-12-20 43-7-19-16-12Z" fill="#efd8a6" stroke="#ac9469" strokeWidth="1.5" strokeLinejoin="round" /><path d="m145 33 27-24" stroke="#ac9469" strokeWidth="1.5" />
    </svg>
  </div>;
}
