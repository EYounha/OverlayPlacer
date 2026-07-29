export interface ArtboardPreset {
  group: string;
  label: string;
  width: number;
  height: number;
}

export const ARTBOARD_PRESETS: ArtboardPreset[] = [
  { group: "데스크톱", label: "FHD", width: 1920, height: 1080 },
  { group: "데스크톱", label: "QHD", width: 2560, height: 1440 },
  { group: "데스크톱", label: "4K UHD", width: 3840, height: 2160 },
  { group: "데스크톱", label: "울트라와이드", width: 3440, height: 1440 },
  { group: "데스크톱", label: "HD", width: 1366, height: 768 },
  { group: "모바일", label: "스마트폰 · 세로", width: 390, height: 844 },
  { group: "모바일", label: "스마트폰 · 가로", width: 844, height: 390 },
  { group: "모바일", label: "안드로이드 · 세로", width: 412, height: 915 },
  { group: "모바일", label: "태블릿 · 세로", width: 820, height: 1180 },
  { group: "모바일", label: "태블릿 · 가로", width: 1280, height: 800 },
  { group: "VR", label: "VR 패널 · 와이드", width: 1600, height: 900 },
  { group: "VR", label: "VR 패널 · 표준", width: 1024, height: 768 },
  { group: "VR", label: "VR 패널 · 정방형", width: 1024, height: 1024 }
];

export const PRESET_GROUPS = ["데스크톱", "모바일", "VR"];
