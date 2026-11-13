import { useRef } from 'react';

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
	const dateInputRef = useRef<HTMLInputElement>(null);

	const openPicker = () => {
		const input = dateInputRef.current;
		if (!input) return;
		try {
			// Chrome/Edge/Firefox support showPicker() inside a user gesture,
			// which opens the calendar regardless of where the click lands.
			input.showPicker();
		} catch {
			// Fall back to letting the click reach the hidden date input.
			input.focus();
		}
	};

	return (
		<div
			role="button"
			tabIndex={0}
			aria-label={ariaLabel}
			onClick={openPicker}
			onKeyDown={(event) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					openPicker();
				}
			}}
			className="relative min-w-0 flex-1 cursor-pointer rounded-xl focus-within:ring-2 focus-within:ring-brand-500 focus-within:ring-offset-2"
		>
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
				ref={dateInputRef}
				type="date"
				value={value}
				onChange={(event) => onChange(event.target.value)}
				aria-label={ariaLabel}
				min={min}
				max={max}
				required={required}
				tabIndex={-1}
				className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
			/>
		</div>
	);
}
