# OverlayPlacer AI 연동 가이드 · 레이아웃 JSON 명세 v1

이 문서는 AI가 OverlayPlacer와 레이아웃을 주고받을 때 따르는 서식 명세입니다.

## 역할

- **AI → 편집기**: 아래 명세대로 레이아웃 JSON을 작성하면 사용자가 OverlayPlacer로 불러와
  위치·크기·계층을 시각적으로 조정합니다.
- **편집기 → AI**: 조정이 끝난 JSON이 다시 전달됩니다. 이 값이 사용자의 최종 결정이므로,
  좌표·크기·앵커·메타데이터를 그대로 반영해 대상 플랫폼의 실제 UI 코드를 구현하세요.

## 최상위 구조

```json
{
  "format": "overlayplacer",
  "version": 1,
  "meta": { "name": "프로젝트명", "description": "설명" },
  "artboards": [ { "...": "아트보드" } ]
}
```

## 아트보드

하나의 화면(해상도)을 나타냅니다. 데스크톱/모바일/VR 등 화면별로 분리해 작성할 수 있습니다.

```json
{
  "id": "ab_main",
  "name": "메인 화면",
  "width": 1920,
  "height": 1080,
  "children": [ { "...": "요소" } ]
}
```

## 요소 (Element)

```json
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
```

### 필드 규칙

| 필드 | 설명 |
| --- | --- |
| `id` | 문서 내 유일. 의미 있는 이름 권장 (예: `el_sidebar_home`) |
| `type` | `panel` `text` `image` `button` `input` `icon` `list` `video` `progress` `custom` |
| `anchor` | 부모 기준 기준점 9종: `top-left` `top-center` `top-right` `middle-left` `middle-center` `middle-right` `bottom-left` `bottom-center` `bottom-right` |
| `x`, `y` | 앵커 기준 오프셋. 양수 x = 오른쪽, 양수 y = 아래쪽 |
| `width`, `height` | 크기 |
| `units` | 필드별 `px` 또는 `%`. `%`는 부모 콘텐츠 크기 대비 백분율. 생략 시 전부 px |
| `rotation` | 도(deg), 시계 방향, 요소 중심 기준. 생략 시 0 |
| `opacity` | 0~1. 생략 시 1 |
| `visible` | `false`면 숨김. 생략 시 표시 |
| `meta` | 자유 key-value 문자열 맵. 폰트·색상·역할·상호작용 등 구현 힌트를 자유롭게 기입 |
| `children` | 자식 요소 배열. 자식의 좌표계는 부모 요소 내부 기준 |

### 앵커 의미

`anchor: "bottom-center"`는 **요소의 하단 중앙**이 **부모의 하단 중앙**을 기준으로
`(x, y)`만큼 떨어져 있다는 뜻입니다. 예: `x: 0, y: -40` → 부모 하단 중앙에서 40px 위.

### 좌표 계산 공식 (px 기준)

부모 크기 `(PW, PH)`, 요소 크기 `(W, H)`, 앵커 비율 `(ax, ay ∈ {0, 0.5, 1})`일 때:

```
요소 좌상단 X = ax × (PW − W) + x
요소 좌상단 Y = ay × (PH − H) + y
```

`%` 단위 필드는 먼저 px로 환산: `값 ÷ 100 × (부모 해당 축 크기)`

## 작성 지침

1. 반응형이 필요한 요소는 앵커와 `%` 단위를 활용하세요.
   예: 화면 하단 고정 바 → `anchor: "bottom-center"`, `width` 100%.
2. 논리적으로 묶이는 요소는 `panel` 타입 부모 아래 `children`으로 중첩하세요.
3. 시각 스타일(색·폰트·모서리 등)은 `meta`에 기입하세요. 편집기는 위치·크기만 다루며
   `meta`는 그대로 보존되어 돌아옵니다.
4. 응답은 JSON 코드 블록 하나로만 작성하면 사용자가 그대로 가져올 수 있습니다.

## 예시 응답

```json
{
  "format": "overlayplacer",
  "version": 1,
  "meta": { "name": "뮤직 플레이어", "description": "데스크톱 음악 앱" },
  "artboards": [
    {
      "id": "ab_main",
      "name": "메인",
      "width": 1600,
      "height": 900,
      "children": [
        {
          "id": "el_sidebar", "name": "사이드바", "type": "panel",
          "x": 0, "y": 0, "width": 260, "height": 900, "anchor": "top-left",
          "meta": { "role": "navigation" },
          "children": [
            { "id": "el_logo", "name": "로고", "type": "image",
              "x": 24, "y": 24, "width": 140, "height": 40, "anchor": "top-left" }
          ]
        },
        {
          "id": "el_nowbar", "name": "재생 바", "type": "panel",
          "x": 0, "y": 0, "width": 100, "height": 96, "anchor": "bottom-center",
          "units": { "x": "px", "y": "px", "width": "%", "height": "px" },
          "children": [
            { "id": "el_play", "name": "재생 버튼", "type": "button",
              "x": 0, "y": 0, "width": 56, "height": 56, "anchor": "middle-center" }
          ]
        }
      ]
    }
  ]
}
```
