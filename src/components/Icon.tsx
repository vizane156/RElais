import React from 'react';

interface IconProps {
  name: string;
  className?: string;
}

export const Icon: React.FC<IconProps> = ({ name, className = 'ic' }) => {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <use href={`/assets/icons.svg#i-${name}`} />
    </svg>
  );
};
