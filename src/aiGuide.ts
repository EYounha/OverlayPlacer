/** AI에게 전달하는 OverlayPlacer 레이아웃 서식 명세 (클립보드 복사용) */
export const AI_GUIDE_MARKDOWN = `# OverlayPlacer 레이아웃 JSON 명세 v1

당신(AI)은 아래 명세를 따르는 JSON으로 UI 레이아웃을 작성하거나 해석합니다.
이 JSON은 OverlayPlacer 편집기에서 시각적으로 조정된 뒤 다시 전달됩니다.
좌표·크기 값이 사용자의 최종 결정이므로, 이 값을 기준으로 실제 UI 코드를 구현하세요.

## 최상위 구조
\`\`\`json
{
  "format": "overlayplacer",
  "version": 1,
  "meta": { "name": "프로젝트명", "description": "설명" },
  "artboards": [ { ...아트보드 } ]
}
\`\`\`

## 아트보드
하나의 화면(해상도)을 나타냅니다.
\`\`\`json
{
  "id": "ab_main",
  "name": "메인 화면",
  "width": 1920,
  "height": 1080,
  "children": [ { ...요소 } ]
}
\`\`\`

## 요소 (Element)
\`\`\`json
{
  "id": "el_play",
  "name": "재생 버튼",
  "type": "button",
  "x": 0, "y": -40,
  "width": 320, "height": 72,
  "anchor": "bottom-center",
  "units": { "x": "px", "y": "px", "width": "px", "height": "px" },
  "rotation": 0,
  "opacity": 1,
  "meta": { "font-size": "18px", "role": "primary-action" },
  "children": []
}
\`\`\`

### 필드 규칙
- \`type\`: panel | text | image | button | input | icon | list | video | progress | custom
- \`anchor\`: 부모 기준 기준점. 9종 —
  top-left, top-center, top-right, middle-left, middle-center, middle-right,
  bottom-left, bottom-center, bottom-right
- \`x\`, \`y\`: 앵커 기준 오프셋. anchor가 top-left면 부모 좌상단 기준,
  bottom-center면 "요소의 하단 중앙"이 "부모의 하단 중앙"에서 얼마나 떨어졌는지를 뜻함.
  (양수 x = 오른쪽, 양수 y = 아래쪽)
- \`units\`: 각 필드가 px인지 %인지. %는 부모 콘텐츠 크기 대비 백분율. 생략 시 전부 px.
- \`rotation\`: 도(deg), 시계 방향, 요소 중심 기준. 생략 시 0.
- \`opacity\`: 0~1. 생략 시 1.
- \`visible\`: false면 숨김. 생략 시 표시.
- \`meta\`: 자유 key-value 문자열 맵. 폰트, 색상, 역할, 상호작용 등
  구현에 필요한 힌트를 자유롭게 기입. 편집기는 이 값을 그대로 보존함.
- \`children\`: 자식 요소 배열. 자식의 좌표계는 부모 요소 내부 기준.
- \`id\`: 문서 내에서 유일해야 함. 의미 있는 이름 권장 (예: el_sidebar_home).

### 좌표 계산 공식 (px 기준)
부모 크기 (PW, PH), 요소 크기 (W, H), 앵커 비율 (ax, ay ∈ {0, 0.5, 1}) 일 때:
- 요소 좌상단 X = ax × (PW − W) + x
- 요소 좌상단 Y = ay × (PH − H) + y
% 단위인 필드는 먼저 px로 환산: 값 ÷ 100 × (부모 해당 축 크기)

### 작성 지침
1. 반응형이 필요한 요소는 anchor와 % 단위를 활용하세요.
   (예: 화면 하단 고정 바 → anchor bottom-center, width 100%)
2. 논리적으로 묶이는 요소는 panel 타입 부모 아래 children으로 중첩하세요.
3. 시각 스타일(색·폰트·모서리 등)은 meta에 기입하세요. 편집기는 위치·크기만 다룹니다.
4. 화면별(데스크톱/모바일/VR)로 아트보드를 분리해 작성할 수 있습니다.
5. 응답은 JSON 코드 블록 하나로만 작성하면 사용자가 그대로 가져올 수 있습니다.
`;
