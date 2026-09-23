import React from 'react';
export default function PageHeader({ name, description }) {
  return <div className="page-heading"><h1>{name}</h1><p>{description}</p></div>;
}
