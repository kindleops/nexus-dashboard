export const TemplateLanguageTabs = ({
  languages,
  value,
  onChange,
}: {
  languages: string[]
  value: string
  onChange: (language: string) => void
}) => (
  <div className="nx-template-tabs" role="tablist" aria-label="Template language tabs">
    {languages.map((language) => (
      <button
        key={language}
        type="button"
        role="tab"
        aria-selected={value === language}
        className={`nx-template-tab ${value === language ? 'is-active' : ''}`}
        onClick={() => onChange(language)}
      >
        {language}
      </button>
    ))}
  </div>
)
