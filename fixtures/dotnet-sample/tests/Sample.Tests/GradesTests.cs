using Sample;
using Xunit;

namespace Sample.Tests;

public class GradesTests
{
    [Theory]
    [InlineData(91, "A")]
    [InlineData(90, "B")]
    [InlineData(76, "B")]
    [InlineData(75, "C")]
    [InlineData(51, "C")]
    [InlineData(50, "F")]
    public void GradesByBand(int n, string expected) => Assert.Equal(expected, Grades.Grade(n));
}
