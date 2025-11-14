# Brand Guidelines - Interview Analyzer

## Brand Identity

### Mission
To provide thoughtful, professional feedback that helps product managers improve their interview skills through AI-powered analysis.

### Brand Values
- **Professional**: Clean, sophisticated interface
- **Trustworthy**: Reliable analysis and secure data handling
- **Supportive**: Constructive feedback, not criticism
- **Efficient**: Quick, streamlined user experience

## Visual Identity

### Color Palette

#### Primary Colors - Warm Terracotta/Clay
```css
--primary-500: #c77a4b  /* Main brand color */
--primary-600: #b86439  /* Hover states */
--primary-700: #9a4f30  /* Active states */
--primary-50: #fdf8f6   /* Light backgrounds */
```

#### Secondary Colors - Sage Green
```css
--sage-500: #738c5f     /* Balance and growth */
--sage-600: #5b7049     /* Darker variant */
```

#### Accent Colors
```css
--accent-gold: #d4a574   /* Success, highlights */
--accent-coral: #e8a598  /* Warnings */
--accent-sky: #a3c4d2    /* Information */
```

#### Neutral Colors
```css
--text-primary: #3a3633   /* Main text */
--text-secondary: #5e5851 /* Secondary text */
--text-muted: #787169     /* Muted text */
--bg-main: #fdfcfb        /* Main background */
```

### Typography

#### Font Stack
- **Headings**: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
- **Body Text**: 'Crimson Pro', Georgia, serif
- **Code/Monospace**: 'SF Mono', Monaco, 'Cascadia Code', monospace

#### Font Sizes
- **Large Title**: 2rem
- **Title**: 1.5rem
- **Heading**: 1.25rem
- **Body**: 1rem
- **Small**: 0.875rem
- **Caption**: 0.75rem

### Spacing System
- Base unit: 0.25rem (4px)
- Spacing scale: 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8

### Border Radius
- Small: 4px (inputs, small buttons)
- Medium: 6px (buttons, cards)
- Large: 8px (modal, large cards)
- Extra Large: 12px (dialogs)
- Round: 14px (toast notifications)

## UI Components

### Buttons

#### Primary Button
- Background: `var(--primary-500)`
- Text: white
- Hover: `var(--primary-600)`
- Border-radius: 6px
- Padding: 0.625rem 1.25rem

#### Secondary Button
- Background: white
- Border: 1px solid `var(--accent-gold)`
- Text: `var(--primary-600)`
- Hover: Background `var(--primary-50)`

#### Icon Button
- Background: white
- Border: 1px solid #ddd
- Size: Square aspect ratio
- Hover: Border color #111

### Toast Notifications
- Position: Top center (4.5rem from top)
- Background: white
- Border: 1px solid rgba(0, 0, 0, 0.05)
- Shadow: Subtle (0 2px 6px rgba(0, 0, 0, 0.08))
- Animation: Slide down, fade out after 1.5s
- Padding: Minimal (0.25rem 0.5rem)
- Font-size: 0.7rem

### Cards
- Background: white
- Border: 1px solid rgba(199, 122, 75, 0.12)
- Border-radius: 8px
- Shadow: 0 1px 2px rgba(0, 0, 0, 0.04)
- Hover: Subtle lift animation

### Status Indicators
- Success: Green (#10b981)
- Warning: Amber (#f59e0b)
- Error: Red/Primary (#c77a4b)
- Info: Sky (#a3c4d2)

### Agent Status Window
- Background: Dark (#1e1e1e)
- Text: Light (#e5e5e5)
- Border: Gold accent
- System messages: Blue theme
- Agent responses: Yellow/amber theme
- Tool executions: Gray, indented
- Font: Monospace

## Interaction Patterns

### Loading States
- Spinner with primary color
- "Analyzing..." text
- Progress indicators where applicable

### Hover Effects
- Subtle color shifts
- Slight transform: translateY(-1px) for lift effect
- Box-shadow enhancement
- Transition: all 0.2s ease

### Focus States
- Outline: 2px solid var(--primary-500)
- Outline-offset: 2px

### Animations
- Duration: 0.2s - 0.3s for most transitions
- Easing: ease-out for entrances, ease-in for exits
- No bouncy or playful animations (maintain professionalism)

## Voice and Tone

### Writing Style
- **Professional but approachable**
- **Concise and clear**
- **Constructive and supportive**
- **Action-oriented**

### UI Copy Guidelines
- Use active voice
- Keep labels short and descriptive
- Error messages should be helpful, not technical
- Success messages should be brief
- CTAs should start with verbs

### Examples
- ✅ "Analyze Interview"
- ✅ "View Analysis"
- ✅ "Auto-saved to history"
- ❌ "Submit Form"
- ❌ "Click Here"
- ❌ "Error Code 403"

## Iconography

### Style
- Line icons preferred
- Stroke width: 1.5px
- Size: 16px standard, 20px for primary actions
- Color: Inherit from parent text color

### No Emojis Policy
- No emojis in production UI
- Use icons or text indicators instead
- Keep professional appearance

## Responsive Design

### Breakpoints
- Mobile: < 768px
- Tablet: 768px - 1024px
- Desktop: > 1024px

### Mobile Considerations
- Touch targets minimum 44x44px
- Increased padding on mobile
- Stack elements vertically
- Simplified navigation

## Accessibility

### Color Contrast
- Normal text: 4.5:1 minimum
- Large text: 3:1 minimum
- Interactive elements: 3:1 minimum

### Keyboard Navigation
- All interactive elements keyboard accessible
- Visible focus indicators
- Logical tab order
- Skip links where appropriate

### Screen Readers
- Semantic HTML
- ARIA labels where needed
- Alt text for images
- Descriptive link text

## File Naming Conventions

### Components
- PascalCase: `AnalysisView.tsx`
- Styles: `AnalysisView.css`

### Utilities
- camelCase: `firebase.ts`
- Constants: UPPER_SNAKE_CASE

### Assets
- kebab-case: `logo-dark.svg`

## Implementation Notes

1. **Always use CSS variables** for colors to maintain consistency
2. **Prefer rem units** for spacing and sizing (not px)
3. **Mobile-first** responsive design approach
4. **Semantic HTML** for better accessibility
5. **Component-based** styling (co-located CSS)
6. **No inline styles** except for dynamic values
7. **Test on multiple browsers** before deployment

## Brand Assets

### Required Files
- `/frontend/src/colors.css` - Color system definition
- `/frontend/src/index.css` - Global styles
- Component-specific CSS files

### Do Not Remove
- Design system files (colors.css)
- Font imports
- CSS reset/normalize

## Updates and Maintenance

This document should be updated when:
- New components are added
- Color palette changes
- Typography system updates
- New patterns are established

Last Updated: November 2024
