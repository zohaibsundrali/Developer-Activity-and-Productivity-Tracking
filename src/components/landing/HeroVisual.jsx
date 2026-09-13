import Image from "next/image";
import heroImage from "../../../public/images/home-hero.png";

export default function HeroVisual() {
  return (
    <Image
      src={heroImage}
      alt=""
      priority
      sizes="(min-width: 1024px) 576px, (min-width: 640px) 512px, 100vw"
      className="h-auto w-full rounded-xl"
    />
  );
}
