import { Stars } from "@react-three/drei";

function StarsField({ isMini = false }) {
  return (
    <Stars
      radius={100}
      depth={50}
      count={isMini ? 800 : 5000}
      factor={4}
      fade
    />
  );
}

export default StarsField;