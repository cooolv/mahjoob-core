package dev.mahjoob.core;

/** مستطيل بإحداثيات الصورة الأصلية (بكسل). */
public final class Box {
    public final double x;
    public final double y;
    public final double width;
    public final double height;

    public Box(double x, double y, double width, double height) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Box)) return false;
        Box b = (Box) o;
        return Double.compare(x, b.x) == 0 && Double.compare(y, b.y) == 0
                && Double.compare(width, b.width) == 0 && Double.compare(height, b.height) == 0;
    }

    @Override
    public int hashCode() {
        return java.util.Arrays.hashCode(new double[]{x, y, width, height});
    }

    @Override
    public String toString() {
        return "Box(" + x + ", " + y + ", " + width + ", " + height + ")";
    }
}
