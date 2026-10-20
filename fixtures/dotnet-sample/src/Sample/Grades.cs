namespace Sample;

public static class Grades
{
    public static string Grade(int n)
    {
        if (n > 90) return "A";
        if (n > 75) return "B";
        return n > 50 ? "C" : "F";
    }
}
