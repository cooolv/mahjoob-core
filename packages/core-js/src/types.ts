/** الجنس المستهدف بالحجب */
export type TargetGender = "female" | "male";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** صورة مجرّدة: النواة لا تعرف نوعها، المحوّلات (Adapters) هي من تفهمها */
export type ImageInput = unknown;

/** نتيجة كشف شخص/وجه واحد من النموذج */
export interface PersonDetection {
  box: Box;
  /** ثقة أن هذا الكشف شخص/وجه فعلًا (0..1) */
  confidence: number;
  /** احتمال أن يكون أنثى (0..1)، أو undefined إن لم يستطع النموذج التصنيف */
  pFemale?: number;
  /** ثقة النموذج في تصنيف الجنس (0..1) */
  genderConfidence?: number;
}

/** واجهة النموذج: تُنفَّذ في الإضافة/التطبيق (ONNX وغيره). النواة لا تضمّن نموذجًا. */
export interface PersonAnalyzer {
  analyze(image: ImageInput, signal?: AbortSignal): Promise<PersonDetection[]>;
}

export type Action = "allow" | "block";

export type Reason =
  | "target-gender"      // شخص بجنس مستهدف
  | "uncertain-gender"   // شخص لم يُحسم جنسه (وضع صارم)
  | "low-confidence"     // كشف ضعيف مشتبه (وضع صارم)
  | "analysis-error"     // خطأ في التحليل
  | "timeout"            // انتهت المهلة
  | "no-person"          // لا أشخاص
  | "no-target";         // أشخاص لكن لا أحد منهم مستهدف

export interface Decision {
  action: Action;
  reason: Reason;
  /** المناطق التي سببت الحجب (للتغطية الجزئية الاختيارية) */
  regions: Box[];
}

export interface Policy {
  /** الجنس الذي يُحجب */
  target: TargetGender;
  /** وضع صارم: أي غموض => حجب (الافتراضي true) */
  strict: boolean;
  /** يُحجب إن كان احتمال الجنس المستهدف >= هذه القيمة (منخفضة عمدًا لتقليل التسريب) */
  blockThreshold: number;
  /** أقل ثقة كشف لاعتبار الكائن شخصًا */
  minPersonConfidence: number;
  /** أقل ثقة تصنيف لاعتبار الجنس محسومًا */
  minGenderConfidence: number;
  /** مهلة التحليل بالمللي ثانية، وبعدها يُحجب */
  timeoutMs: number;
}

export const DEFAULT_POLICY: Readonly<Omit<Policy, "target">> = {
  strict: true,
  blockThreshold: 0.2,
  minPersonConfidence: 0.35,
  minGenderConfidence: 0.6,
  timeoutMs: 3000,
};
