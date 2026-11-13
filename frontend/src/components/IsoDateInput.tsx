type IsoDateInputProps = {
	value: string;
	onChange: (value: string) => void;
	className: string;
	"aria-label": string;
	min?: string;
	max?: string;
	required?: boolean;
};

export function IsoDateInput({
	value,
	onChange,
	className,
	"aria-label": ariaLabel,
	min,
	max,
	required,
}: IsoDateInputProps) {
	return (
		<div className="relative min-w-0 flex-1 rounded-xl focus-within:ring-2 focus-within:ring-brand-500 focus-within:ring-offset-2">
			<input
				type="text"
				value={value}
				placeholder="YYYY-MM-DD"
				readOnly
				tabIndex={-1}
				aria-hidden="true"
				className={`pointer-events-none ${className}`}
			/>
			<input
				type="date"
				value={value}
				onChange={(event) => onChange(event.target.value)}
				aria-label={ariaLabel}
				min={min}
				max={max}
				required={required}
				className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
			/>
		</div>
	);
}
