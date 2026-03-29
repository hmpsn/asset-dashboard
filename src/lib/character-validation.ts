export interface CharacterValidation {
  isValid: boolean;
  count: number;
  percentage: number;
  truncated: string;
  colorClass: 'green' | 'amber' | 'red';
  isNearLimit: boolean;
  isOverLimit: boolean;
}

export function validateCharacterCount(text: string, max: number): CharacterValidation {
  const count = text.length;
  const percentage = (count / max) * 100;
  
  let colorClass: 'green' | 'amber' | 'red' = 'green';
  if (percentage >= 95) {
    colorClass = 'red';
  } else if (percentage >= 80) {
    colorClass = 'amber';
  }
  
  const truncated = count > max ? truncateSmart(text, max) : text;
  
  return {
    isValid: count <= max,
    count,
    percentage,
    truncated,
    colorClass,
    isNearLimit: percentage >= 80,
    isOverLimit: count > max
  };
}

export function truncateSmart(text: string, max: number): string {
  if (text.length <= max) return text;
  
  const truncated = text.slice(0, max);
  const lastSpace = truncated.lastIndexOf(' ');
  
  // If we're close to the limit and found a space, truncate at the space
  if (lastSpace > max * 0.6) {
    return truncated.slice(0, lastSpace);
  }
  
  // Otherwise truncate at the limit
  return truncated;
}

export function getColorClass(percentage: number): string {
  if (percentage >= 95) return 'text-red-400/80';
  if (percentage >= 80) return 'text-amber-400/80';
  return 'text-emerald-400/80';
}
