#!/usr/bin/env perl
use strict;
use warnings;
use JSON::PP;

# remove_unused_keys.pl
# Usage:
#   remove_unused_keys.pl <json-file> <keys-file>
# or
#   cat keys.txt | remove_unused_keys.pl <json-file>
#
# Reads keys in dot notation (one per line) and removes them from the JSON
# structure. After deletions, prunes empty objects. Writes the modified JSON
# back to the original file (no backup).

my $json_file = shift or die "Usage: $0 <json-file> [keys-file]\n";
my $keys_file = shift || '-';

# read keys
my @keys;
if ($keys_file eq '-') {
    while (<STDIN>) { chomp; next unless length; push @keys, $_ }
} else {
    open my $kf, '<', $keys_file or die "Can't open keys file $keys_file: $!\n";
    while (<$kf>) { chomp; next unless length; push @keys, $_ }
    close $kf;
}

open my $jf, '<', $json_file or die "Can't open json file $json_file: $!\n";
local $/;
my $json_text = <$jf>;
close $jf;

my $decoder = JSON::PP->new->relaxed->allow_nonref;
my $data = eval { $decoder->decode($json_text) };
if ($@) { die "Failed to parse JSON in $json_file: $@\n" }

sub delete_key {
    my ($root, $path) = @_;
    my @parts = split /\./, $path;
    my $last = pop @parts;
    my $node = $root;
    for my $p (@parts) {
        return 0 unless ref($node) eq 'HASH' && exists $node->{$p};
        $node = $node->{$p};
    }
    if (ref($node) eq 'HASH' && exists $node->{$last}) {
        delete $node->{$last};
        return 1;
    }
    return 0;
}

sub prune_empty {
    my ($node) = @_;
    return 0 unless ref($node) eq 'HASH';
    for my $k (keys %$node) {
        if (ref($node->{$k}) eq 'HASH') {
            prune_empty($node->{$k});
            # delete if now empty
            if (ref($node->{$k}) eq 'HASH' && (keys %{ $node->{$k} } ) == 0) {
                delete $node->{$k};
            }
        }
    }
}

my $removed = 0;
for my $k (@keys) {
    $removed += delete_key($data, $k);
}

# prune top-level empties
prune_empty($data);

# Use UTF-8 output, pretty printing with explicit 2-space indent.
# Do NOT use canonical (sorted) keys so we avoid reordering keys which
# makes diffs and formatting look very different from the original file.
my $encoder = JSON::PP->new->utf8->pretty->indent_length(2);
my $out = $encoder->encode($data);

open my $of, '>', $json_file or die "Can't write to $json_file: $!\n";
print $of $out;
close $of;

print STDERR "Removed $removed keys from $json_file\n";
exit 0;
